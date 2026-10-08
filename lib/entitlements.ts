import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  entitlements,
  events,
  users,
  type Entitlement,
  type EntitlementSource,
  type Event,
} from "./schema";
import { PLANS, getPlan, type PlanKey } from "./plans";
import { log } from "./observability";

/**
 * ACT-1: what an account has been granted, and what that makes each event.
 *
 * The model, in one paragraph. Klik Event and Klik Premium are **passes**: one
 * pass licenses one event, once, forever. Klik Venue is an **account grant**:
 * it licenses the owner's events up to limits copied onto the grant when it was
 * made. An event with neither is a **draft** the organizer can set up and
 * nobody else can see. An event whose licence was revoked is **lapsed**: the
 * gallery stays viewable for the rest of its window, because guests did
 * nothing wrong (ROADMAP.md C-6), and nothing more can be uploaded.
 *
 * Every grant today comes from a superadmin, which is the rule in BILLING.md:
 * no payment grants anything by itself. `source` is on every row so that
 * changing that later is one handler writing `stripe` rows, not a redesign.
 *
 * The hot paths never call into this file's database half. An event carries its
 * own `plan_key` and `entitlement_id`, so `eventPlan(event)` and
 * `eventLicenseState(event)` answer from the row the route already loaded.
 */

export { eventLicenseState, eventPlan, windowStart, scopeForPlan, isGrantCurrent, describeLicenseRefusal } from "./license";
export type { LicenseState } from "./license";
import { describeLicenseRefusal, isGrantCurrent, scopeForPlan } from "./license";

const LIMIT_CODES = [
  "entitlement_active_limit",
  "entitlement_monthly_limit",
  "entitlement_already_applied",
  "entitlement_inactive",
  "entitlement_owner_mismatch",
  "entitlement_missing",
] as const;

function limitCode(error: unknown): string | null {
  const text = [error, (error as { cause?: unknown })?.cause]
    .map((value) => (value instanceof Error ? value.message : String(value ?? "")))
    .join(" ");
  return LIMIT_CODES.find((code) => text.includes(code)) ?? null;
}

// --- Reads -----------------------------------------------------------------

export interface AccountEntitlements {
  /** Passes bought or granted and not yet spent on an event. */
  unusedPasses: Entitlement[];
  /** Account grants in force right now. In practice, Venue. */
  accountGrants: Entitlement[];
  /** Everything, revoked included, newest first, for history screens. */
  all: Entitlement[];
}

export async function getAccountEntitlements(userId: string, now = new Date()): Promise<AccountEntitlements> {
  const rows = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .orderBy(sql`${entitlements.createdAt} DESC`);
  return {
    unusedPasses: rows
      .filter((row) => row.scope === "event" && row.status === "active" && !row.appliedAt)
      .reverse(),
    accountGrants: rows.filter((row) => row.scope === "account" && isGrantCurrent(row, now)),
    all: rows,
  };
}

/** The account-level questions: the venue hub, client records, the venue QR. */
export async function hasVenueGrant(userId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.scope, "account"),
        eq(entitlements.planKey, "venue"),
        eq(entitlements.status, "active"),
        sql`${entitlements.startsAt} <= ${now}`,
        or(isNull(entitlements.endsAt), gt(entitlements.endsAt, now)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// --- Licensing ---------------------------------------------------------------

export type LicenseResult =
  | { licensed: true; planKey: PlanKey; entitlementId: string }
  | { licensed: false; reason: string };

/**
 * Points an event at a grant. The trigger in drizzle/0018_entitlements.sql has
 * the final say on limits and on a pass being spent twice, and its refusal comes
 * back here as a reason a person can read rather than as a 500.
 *
 * Retention moves outward only, as everywhere else (SEC-1): going live extends
 * the window to the plan's length from now, and never shortens one.
 */
async function licenseEvent(eventId: string, grant: Entitlement): Promise<LicenseResult> {
  const plan = getPlan(grant.planKey);
  try {
    const [row] = await db
      .update(events)
      .set({
        entitlementId: grant.id,
        planKey: grant.planKey,
        licensedAt: sql`COALESCE(${events.licensedAt}, now())`,
        retentionUntil: sql`GREATEST(
          COALESCE(${events.retentionUntil}, now()),
          COALESCE(${events.licensedAt}, now()) + (${plan.galleryAccessDays}::int * interval '1 day')
        )`,
        updatedAt: new Date(),
      })
      .where(and(eq(events.id, eventId), eq(events.ownerId, grant.userId)))
      .returning({ id: events.id });
    if (!row) return { licensed: false, reason: "Event not found." };
    return { licensed: true, planKey: grant.planKey, entitlementId: grant.id };
  } catch (error) {
    const code = limitCode(error);
    if (!code) throw error;
    return { licensed: false, reason: describeLicenseRefusal(code, plan) };
  }
}

/**
 * Spends the account's oldest unused pass on this event.
 *
 * The pass is claimed in one statement (`FOR UPDATE SKIP LOCKED`), the same
 * shape as the job queue's claim, so two events created at once cannot both
 * spend one pass. `applied_at` is the permanent "spent" mark: it is never
 * cleared, so a pass cannot come back if its event is later purged.
 *
 * Claim first, then license. If the second step fails the pass is marked spent
 * on this event without the event knowing, and `reconcileLicenses` repairs
 * exactly that. The other order would let one pass license two events.
 */
async function spendPass(userId: string, eventId: string, passId?: string): Promise<Entitlement | null> {
  const candidate = db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.scope, "event"),
        eq(entitlements.status, "active"),
        isNull(entitlements.appliedAt),
        ...(passId ? [eq(entitlements.id, passId)] : []),
      ),
    )
    .orderBy(asc(entitlements.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await db
    .update(entitlements)
    .set({ appliedAt: sql`now()`, appliedEventId: eventId })
    .where(inArray(entitlements.id, candidate))
    .returning();
  return claimed ?? null;
}

/**
 * Makes an event live with whatever the account has: an account grant first,
 * since it costs nothing to use, then the oldest unused pass. Leaves it a draft
 * when there is neither, which is a normal outcome and not an error.
 */
export async function licenseWithAvailableGrant(
  event: Pick<Event, "id" | "ownerId">,
): Promise<LicenseResult> {
  const { accountGrants } = await getAccountEntitlements(event.ownerId);
  let refusal: string | null = null;
  for (const grant of accountGrants) {
    const result = await licenseEvent(event.id, grant);
    if (result.licensed) return result;
    refusal = result.reason;
  }

  const pass = await spendPass(event.ownerId, event.id);
  if (pass) return licenseEvent(event.id, pass);

  return { licensed: false, reason: refusal ?? "No plan is available for this event yet." };
}

// --- Granting and revoking ---------------------------------------------------

export interface GrantInput {
  userId: string;
  planKey: PlanKey;
  source: EntitlementSource;
  /** Required for admin grants: an ungoverned comp is how revenue disappears. */
  reason: string;
  grantedBy?: { id: string; label: string | null } | null;
  endsAt?: Date | null;
  stripeRef?: string | null;
  /** License this event with the new grant right away. */
  applyToEventId?: string | null;
}

export interface GrantResult {
  entitlement: Entitlement;
  /** Events the grant licensed straight away, with any that it could not. */
  licensed: string[];
  refused: Array<{ eventId: string; reason: string }>;
  /** True when this grant was the account's first, which is what sends the access email. */
  firstActivation: boolean;
}

/**
 * Records a grant and puts it to work. A pass goes to the event named, or to
 * the account's oldest draft; an account grant licenses every waiting draft it
 * has room for. Then `users.activated_at` is stamped, once, which is what the
 * dashboard and the activation email still key off.
 */
export async function grantEntitlement(input: GrantInput): Promise<GrantResult> {
  const scope = scopeForPlan(input.planKey);
  const plan = PLANS[input.planKey];

  const [entitlement] = await db
    .insert(entitlements)
    .values({
      id: `ent_${nanoid()}`,
      userId: input.userId,
      planKey: input.planKey,
      scope,
      source: input.source,
      reason: input.reason,
      grantedByUserId: input.grantedBy?.id ?? null,
      grantedByLabel: input.grantedBy?.label ?? null,
      endsAt: input.endsAt ?? null,
      stripeRef: input.stripeRef ?? null,
      maxActiveEvents: scope === "account" ? plan.maxActiveEvents : null,
      maxEventsPerMonth: scope === "account" ? plan.maxEventsPerMonth : null,
    })
    .returning();

  const drafts = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.ownerId, input.userId),
        isNull(events.entitlementId),
        isNull(events.licensedAt),
        isNull(events.deletedAt),
      ),
    )
    .orderBy(asc(events.createdAt));

  const targets = input.applyToEventId
    ? [input.applyToEventId]
    : scope === "event"
      ? drafts.slice(0, 1).map((draft) => draft.id)
      : drafts.map((draft) => draft.id);

  const licensed: string[] = [];
  const refused: Array<{ eventId: string; reason: string }> = [];
  for (const eventId of targets) {
    let result: LicenseResult;
    if (scope === "event") {
      const pass = await spendPass(input.userId, eventId, entitlement.id);
      result = pass ? await licenseEvent(eventId, pass) : { licensed: false, reason: "The pass is already spent." };
    } else {
      result = await licenseEvent(eventId, entitlement);
    }
    if (result.licensed) licensed.push(eventId);
    else refused.push({ eventId, reason: result.reason });
  }

  // Read before stamping, because the COALESCE makes the column look the same
  // afterwards either way, and "was this the first grant" decides the email.
  const [before] = await db
    .select({ activatedAt: users.activatedAt })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  await db
    .update(users)
    .set({ activatedAt: sql`COALESCE(${users.activatedAt}, now())` })
    .where(eq(users.id, input.userId));

  log.info("entitlements.granted", {
    entitlementId: entitlement.id,
    userId: input.userId,
    planKey: input.planKey,
    source: input.source,
    licensed: licensed.length,
    refused: refused.length,
  });

  const [fresh] = await db.select().from(entitlements).where(eq(entitlements.id, entitlement.id)).limit(1);
  return { entitlement: fresh ?? entitlement, licensed, refused, firstActivation: !before?.activatedAt };
}

/**
 * Revokes a grant and lapses what it licensed. Lapsed, not deleted and not
 * hidden: guests keep the gallery for the rest of its window and only uploads
 * stop. A pass that was never spent simply stops being spendable.
 */
export async function revokeEntitlement(
  entitlementId: string,
  { by, reason }: { by: { id: string } | null; reason: string },
): Promise<{ revoked: boolean; lapsedEvents: number }> {
  const [row] = await db
    .update(entitlements)
    .set({
      status: "revoked",
      revokedAt: sql`now()`,
      revokedByUserId: by?.id ?? null,
      revokeReason: reason,
    })
    .where(and(eq(entitlements.id, entitlementId), eq(entitlements.status, "active")))
    .returning({ id: entitlements.id });
  if (!row) return { revoked: false, lapsedEvents: 0 };

  const lapsed = await db
    .update(events)
    .set({ entitlementId: null, updatedAt: new Date() })
    .where(eq(events.entitlementId, entitlementId))
    .returning({ id: events.id });

  log.info("entitlements.revoked", { entitlementId, lapsedEvents: lapsed.length });
  return { revoked: true, lapsedEvents: lapsed.length };
}

/**
 * Repairs the one inconsistency the two-step pass spend can leave: a pass
 * marked spent on an event that never got pointed at it. Also lapses events
 * whose account grant has ended, since an end date passes without anything
 * writing to the row. Run daily from the job queue.
 */
export async function reconcileLicenses(now = new Date()): Promise<{ repaired: number; lapsed: number }> {
  const orphanedSpends = await db
    .select({ entitlement: entitlements })
    .from(entitlements)
    .innerJoin(events, eq(events.id, entitlements.appliedEventId))
    .where(
      and(
        eq(entitlements.scope, "event"),
        eq(entitlements.status, "active"),
        isNull(events.entitlementId),
        isNull(events.deletedAt),
      ),
    );
  let repaired = 0;
  for (const { entitlement } of orphanedSpends) {
    const result = await licenseEvent(entitlement.appliedEventId!, entitlement);
    if (result.licensed) repaired += 1;
  }

  const ended = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(and(eq(entitlements.status, "active"), sql`${entitlements.endsAt} <= ${now}`));
  let lapsed = 0;
  if (ended.length > 0) {
    const rows = await db
      .update(events)
      .set({ entitlementId: null, updatedAt: new Date() })
      .where(inArray(events.entitlementId, ended.map((row) => row.id)))
      .returning({ id: events.id });
    lapsed = rows.length;
  }

  if (repaired || lapsed) log.info("entitlements.reconciled", { repaired, lapsed });
  return { repaired, lapsed };
}
