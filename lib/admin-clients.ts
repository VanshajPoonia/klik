import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { accountCredits, accountTimeline, entitlements, events, referrals, users } from "@/lib/schema";
import { eventLicenseState, type LicenseState } from "@/lib/license";
import { getPlan } from "@/lib/plans";
import type { EntitlementRow } from "@/components/admin/entitlement-list";

/**
 * What /admin shows about accounts: one row each for the list, and everything
 * about one account for its own page. Read here rather than in the pages so
 * the list and the page agree on what "live", "waiting" and "guest" mean.
 */

/**
 * Who an account is, as far as running events goes.
 *
 * `customer` came to run events (signed up, opened a plan's link, owns an
 * event, or has been granted something). `guest` signed in only to keep the
 * galleries they joined, which since ACC-2 is most accounts, and listing them
 * among customers buried the ones waiting on a decision. `admin` is Klik.
 */
export type ClientKind = "customer" | "guest" | "admin";

export interface ClientSummary {
  userId: string;
  name: string | null;
  email: string | null;
  username: string | null;
  kind: ClientKind;
  activated: boolean;
  joined: string;
  plan: string;
  live: number;
  drafts: number;
  lapsed: number;
  /** Drafts whose organizer pressed "Ask Klik to activate it". */
  requested: number;
}

const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export async function listClientSummaries(): Promise<ClientSummary[]> {
  const live = sql<number>`count(${events.id}) FILTER (WHERE ${events.entitlementId} IS NOT NULL)::int`;
  const drafts = sql<number>`count(${events.id}) FILTER (WHERE ${events.entitlementId} IS NULL AND ${events.licensedAt} IS NULL)::int`;
  const lapsed = sql<number>`count(${events.id}) FILTER (WHERE ${events.entitlementId} IS NULL AND ${events.licensedAt} IS NOT NULL)::int`;
  const requested = sql<number>`count(${events.id}) FILTER (WHERE ${events.licensedAt} IS NULL AND ${events.activationRequestedAt} IS NOT NULL)::int`;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      role: users.role,
      activatedAt: users.activatedAt,
      organizerIntentAt: users.organizerIntentAt,
      createdAt: users.createdAt,
      live,
      drafts,
      lapsed,
      requested,
    })
    .from(users)
    .leftJoin(events, and(eq(events.ownerId, users.id), isNull(events.deletedAt)))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  const grants = rows.length
    ? await db
        .select({
          userId: entitlements.userId,
          planKey: entitlements.planKey,
          scope: entitlements.scope,
          appliedAt: entitlements.appliedAt,
          endsAt: entitlements.endsAt,
        })
        .from(entitlements)
        .where(eq(entitlements.status, "active"))
    : [];
  const byUser = new Map<string, typeof grants>();
  for (const grant of grants) byUser.set(grant.userId, [...(byUser.get(grant.userId) ?? []), grant]);

  return rows
    .filter((row) => row.role !== "superadmin" || row.live + row.drafts + row.lapsed > 0)
    .map((row) => {
      const held = byUser.get(row.userId) ?? [];
      const kind: ClientKind =
        row.role === "superadmin"
          ? "admin"
          : row.organizerIntentAt || row.activatedAt || held.length > 0 || row.live + row.drafts + row.lapsed > 0
            ? "customer"
            : "guest";
      return {
        userId: row.userId,
        name: row.name,
        email: row.email,
        username: row.username,
        kind,
        activated: Boolean(row.activatedAt),
        joined: day(row.createdAt),
        plan: planSummary(held),
        live: row.live,
        drafts: row.drafts,
        lapsed: row.lapsed,
        requested: row.requested,
      };
    });
}

/** "Klik Venue until 16 Jan 2027", "2 unused passes", "No plan". */
function planSummary(held: Array<{ planKey: Parameters<typeof getPlan>[0]; scope: "event" | "account"; appliedAt: Date | null; endsAt: Date | null }>) {
  const account = held.find((grant) => grant.scope === "account");
  const unused = held.filter((grant) => grant.scope === "event" && !grant.appliedAt).length;
  const parts: string[] = [];
  if (account) parts.push(`${getPlan(account.planKey).name}${account.endsAt ? ` until ${day(account.endsAt)}` : ""}`);
  if (unused) parts.push(`${unused} unused ${unused === 1 ? "pass" : "passes"}`);
  if (parts.length === 0) {
    const used = held.filter((grant) => grant.scope === "event").length;
    return used ? `${used} ${used === 1 ? "pass" : "passes"} in use` : "No plan";
  }
  return parts.join(", ");
}

export interface ClientEvent {
  id: string;
  name: string;
  slug: string;
  clientName: string | null;
  visibility: "public" | "password" | "private";
  license: LicenseState;
  planName: string | null;
  eventDate: string | null;
  requestedAt: string | null;
  deleted: boolean;
}

/** Everything /admin/clients/[userId] shows, in a handful of queries. */
export async function getClientDetail(userId: string) {
  const [account] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return null;

  const referrer = alias(users, "referrer");
  const [eventRows, grantRows, [credit], [referred], history] = await Promise.all([
    db
      .select()
      .from(events)
      .where(eq(events.ownerId, userId))
      .orderBy(sql`${events.deletedAt} IS NOT NULL`, desc(events.createdAt)),
    db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(desc(entitlements.createdAt)),
    db
      .select({ total: sql<number>`coalesce(sum(${accountCredits.amountCents}), 0)::int` })
      .from(accountCredits)
      .where(eq(accountCredits.userId, userId)),
    db
      .select({ name: referrer.name, username: referrer.username, qualifiedAt: referrals.qualifiedAt })
      .from(referrals)
      .innerJoin(referrer, eq(referrer.id, referrals.referrerId))
      .where(eq(referrals.referredId, userId))
      .limit(1),
    db
      .select({
        id: accountTimeline.id,
        kind: accountTimeline.kind,
        detail: accountTimeline.detail,
        actor: accountTimeline.actorLabel,
        at: accountTimeline.createdAt,
      })
      .from(accountTimeline)
      .where(eq(accountTimeline.userId, userId))
      .orderBy(desc(accountTimeline.createdAt))
      .limit(25),
  ]);

  const eventNames = new Map(eventRows.map((row) => [row.id, row.name]));
  const clientEvents: ClientEvent[] = eventRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    clientName: row.clientName,
    visibility: row.visibility,
    license: eventLicenseState(row),
    planName: row.planKey ? getPlan(row.planKey).name : null,
    eventDate: row.eventDate ? day(row.eventDate) : null,
    requestedAt: row.activationRequestedAt && !row.licensedAt ? day(row.activationRequestedAt) : null,
    deleted: Boolean(row.deletedAt),
  }));

  const grants: EntitlementRow[] = grantRows.map((grant) => ({
    id: grant.id,
    planName: getPlan(grant.planKey).name,
    scope: grant.scope,
    status: grant.status,
    spent: Boolean(grant.appliedAt),
    spentOn: grant.appliedEventId
      ? (eventNames.get(grant.appliedEventId) ?? "a removed event")
      : grant.appliedAt
        ? "a removed event"
        : null,
    reason: grant.reason,
    grantedBy: grant.grantedByLabel,
    createdAt: day(grant.createdAt),
    endsAt: grant.endsAt ? day(grant.endsAt) : null,
    endsOn: grant.endsAt ? grant.endsAt.toISOString().slice(0, 10) : null,
    revokeReason: grant.revokeReason,
    paid:
      grant.amountCents === null
        ? null
        : grant.amountCents === 0
          ? "Comp"
          : `Paid $${(grant.amountCents / 100).toFixed(grant.amountCents % 100 ? 2 : 0)}`,
    inGrace: Boolean(grant.graceStartedAt),
  }));

  const active = grantRows.filter((grant) => grant.status === "active");
  return {
    account,
    events: clientEvents,
    grants,
    plan: planSummary(active),
    creditCents: credit?.total ?? 0,
    history: history.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      detail: entry.detail,
      actor: entry.actor,
      at: entry.at.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    })),
    referredBy: referred
      ? {
          name: referred.name?.trim() || (referred.username ? `@${referred.username}` : "an account"),
          qualified: Boolean(referred.qualifiedAt),
        }
      : null,
  };
}

/** Drafts waiting on Klik, soonest event first, for the queue on /admin. */
export async function listWaitingToGoLive() {
  return db
    .select({
      eventId: events.id,
      eventName: events.name,
      eventDate: events.eventDate,
      requestedAt: events.activationRequestedAt,
      urgent: sql<boolean>`${events.eventDate} < now() + interval '3 days'`,
      licensedAt: events.licensedAt,
      userId: users.id,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(
      and(
        sql`${events.activationRequestedAt} IS NOT NULL`,
        isNull(events.licensedAt),
        isNull(events.deletedAt),
      ),
    )
    .orderBy(sql`${events.eventDate} ASC NULLS LAST`, asc(events.activationRequestedAt));
}
