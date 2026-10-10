import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { entitlements, users } from "./schema";
import { enqueue, type JobPayload } from "./jobs";
import { env, getAppUrl } from "./env";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { recordAccountEvent } from "./timeline";
import { getPlan } from "./plans";
import { log } from "./observability";

/**
 * PAY-8: a Venue subscription whose payment failed. Decision C-6: everything
 * keeps working for 7 days, then the galleries stop taking photos and stay
 * viewable and downloadable. Media is never deleted as a payment lever.
 *
 * Klik takes payment through hosted Stripe links, so nothing here knows a
 * payment failed: Stripe tells the superadmin (and the customer, if its own
 * failed-payment emails are on), and the superadmin starts the grace on the
 * account's card on /admin. That sets the grant's `ends_at` a week out, which
 * the daily reconcile already turns into a lapse, and queues three emails to
 * the organizer: now, on day 3 and on day 6. Recording the payment clears it.
 */

export const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type GraceOutcome = { ok: true; endsAt: Date | null } | { ok: false; status: number; error: string };

export async function startGrace(entitlementId: string, by: { id: string; label: string | null }, now = new Date()): Promise<GraceOutcome> {
  const endsAt = new Date(now.getTime() + GRACE_DAYS * DAY_MS);
  const [grant] = await db
    .update(entitlements)
    .set({ graceStartedAt: now, endsAt })
    .where(
      and(
        eq(entitlements.id, entitlementId),
        eq(entitlements.scope, "account"),
        eq(entitlements.status, "active"),
        isNull(entitlements.graceStartedAt),
        // A grant that already ends sooner keeps its earlier date.
        sql`(${entitlements.endsAt} IS NULL OR ${entitlements.endsAt} > ${endsAt})`,
      ),
    )
    .returning({ userId: entitlements.userId, planKey: entitlements.planKey });
  if (!grant) {
    return { ok: false, status: 409, error: "Only an active plan without a grace or an earlier end can be given one." };
  }

  const startedAt = now.toISOString();
  for (const day of [0, 3, 6] as const) {
    await enqueue(
      "notify.grace",
      { entitlementId, startedAt, day },
      { runAfter: new Date(now.getTime() + day * DAY_MS), dedupeKey: `grace:${entitlementId}:${startedAt}:${day}`, maxAttempts: 3 },
    );
  }
  await recordAccountEvent({
    userId: grant.userId,
    kind: "plan_changed",
    detail: `Payment failed: ${getPlan(grant.planKey).name} keeps working until ${endsAt.toDateString()}, then lapses unless paid.`,
    actor: by,
  });
  return { ok: true, endsAt };
}

/** Payment came in: the plan runs on with no end date, as before. */
export async function clearGrace(entitlementId: string, by: { id: string; label: string | null }): Promise<GraceOutcome> {
  const [grant] = await db
    .update(entitlements)
    .set({ graceStartedAt: null, endsAt: null })
    .where(and(eq(entitlements.id, entitlementId), eq(entitlements.status, "active"), isNotNull(entitlements.graceStartedAt)))
    .returning({ userId: entitlements.userId, planKey: entitlements.planKey });
  if (!grant) return { ok: false, status: 409, error: "That plan is not in a grace." };
  await recordAccountEvent({
    userId: grant.userId,
    kind: "plan_changed",
    detail: `Payment received: ${getPlan(grant.planKey).name} continues with no end date.`,
    actor: by,
  });
  return { ok: true, endsAt: null };
}

/** The words for one of the grace emails. Pure, for the tests. */
export function graceMessage({
  day,
  name,
  planName,
  endsAt,
  fixUrl,
  canSelfServe,
}: {
  day: 0 | 3 | 6;
  name: string | null;
  planName: string;
  endsAt: Date;
  fixUrl: string;
  canSelfServe: boolean;
}) {
  const when = endsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const greeting = name?.trim() ? `Hi ${name.trim()},` : "Hi,";
  const fix = canSelfServe
    ? "Update your card from the button below and it is sorted. If you already have, there is nothing to do."
    : "Reply to this email or call us, and we will sort it out with you.";
  const lines = {
    0: {
      subject: `Your ${planName} payment did not go through`,
      heading: "Your payment did not go through",
      lead: `The latest payment for ${planName} failed. Nothing changes yet: every gallery keeps working until ${when}.`,
    },
    3: {
      subject: `${planName}: payment still needed by ${when}`,
      heading: "Your payment is still needed",
      lead: `We have not received the payment for ${planName}. Your galleries keep working until ${when}.`,
    },
    6: {
      subject: `${planName} pauses tomorrow`,
      heading: "Your galleries pause tomorrow",
      lead: `Without a payment, your galleries stop taking new photos on ${when}. Guests can still see and download everything, and nothing is deleted.`,
    },
  }[day];
  return noticeEmail({
    subject: lines.subject,
    heading: lines.heading,
    paragraphs: [greeting, lines.lead, fix],
    cta: { label: canSelfServe ? "Update your card" : "See your billing", url: fixUrl },
    footer: "You are receiving this because a payment for your Klik plan did not go through.",
  });
}

/** Sends one grace email, if that grace is still running. */
export async function sendGraceNotice(payload: JobPayload<"notify.grace">): Promise<void> {
  const [row] = await db
    .select({ grant: entitlements, email: users.email, name: users.name })
    .from(entitlements)
    .innerJoin(users, eq(users.id, entitlements.userId))
    .where(eq(entitlements.id, payload.entitlementId))
    .limit(1);
  const grant = row?.grant;
  if (
    !grant ||
    grant.status !== "active" ||
    !grant.graceStartedAt ||
    grant.graceStartedAt.toISOString() !== payload.startedAt ||
    !grant.endsAt ||
    !row.email
  ) {
    log.info("grace.notice_skipped", { entitlementId: payload.entitlementId, day: payload.day });
    return;
  }
  const portal = env.STRIPE_BILLING_PORTAL_URL;
  const message = graceMessage({
    day: payload.day,
    name: row.name,
    planName: getPlan(grant.planKey).name,
    endsAt: grant.endsAt,
    fixUrl: portal ?? `${getAppUrl()}/dashboard/billing`,
    canSelfServe: Boolean(portal),
  });
  const result = await sendEmail({ ...message, to: row.email });
  await recordAccountEvent({
    userId: grant.userId,
    kind: result.sent ? "grace_email_sent" : "grace_email_failed",
    detail: result.sent ? `Grace email, day ${payload.day}, sent.` : `Grace email, day ${payload.day}, could not be sent.`,
  });
}
