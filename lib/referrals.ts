import { nanoid } from "nanoid";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { accountCredits, entitlements, referrals, users } from "./schema";
import { recordAccountEvent } from "./timeline";

/**
 * GRW-5: referral credits.
 *
 * Every organizer got here by being a guest at somebody else's event, so the
 * gallery's own "made with Klik" link carries its host's code, and every
 * account has a link of its own to hand out. Someone who arrives through one
 * and becomes a customer earns both sides a credit.
 *
 * Credit is money owed against a future purchase, kept as a ledger. It is
 * never spent automatically: Klik takes payment through hosted Stripe links
 * and a person grants every plan (BILLING.md), so a superadmin uses credit
 * the same way, by hand, with a reason, typically as a partial refund of the
 * next payment. A referral qualifies at the first grant of a plan, which is
 * the moment a human has matched the account to a payment.
 */

/** What each side earns. A business decision, recorded in ROADMAP.md Section C. */
export const REFERRAL_CREDIT_CENTS = 1000;

export const REFERRAL_COOKIE = "klik_ref";
export const REFERRAL_COOKIE_DAYS = 30;

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{6,20}$/.test(value);
}

export function formatCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const text = Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  return cents < 0 ? `-${text}` : text;
}

/** The account a code belongs to, in words a stranger may see. */
export async function referrerByCode(code: string) {
  if (!isReferralCode(code)) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1);
  return row ?? null;
}

/**
 * Records who brought this account, once. Refused for yourself, and for an
 * account that is already a customer: a referral is about the path to the
 * first purchase, so it cannot be attached afterwards to collect a credit.
 */
export async function attachReferral(userId: string, code: string | null | undefined): Promise<boolean> {
  if (!code) return false;
  const referrer = await referrerByCode(code);
  if (!referrer || referrer.id === userId) return false;
  const [customer] = await db.select({ id: entitlements.id }).from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  if (customer) return false;
  const inserted = await db
    .insert(referrals)
    .values({ id: nanoid(), referrerId: referrer.id, referredId: userId })
    .onConflictDoNothing({ target: referrals.referredId })
    .returning({ id: referrals.id });
  return inserted.length > 0;
}

/**
 * Called after a plan is granted. The first grant to a referred account
 * qualifies its referral and credits both sides, once: the update is
 * conditional, and each side's credit is unique per referral.
 */
export async function qualifyReferral(userId: string): Promise<{ referrerId: string } | null> {
  const [referral] = await db
    .update(referrals)
    .set({ qualifiedAt: sql`now()` })
    .where(and(eq(referrals.referredId, userId), isNull(referrals.qualifiedAt)))
    .returning({ id: referrals.id, referrerId: referrals.referrerId });
  if (!referral) return null;

  const [referred] = await db.select({ name: users.name, username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  const who = referred?.name?.trim() || (referred?.username ? `@${referred.username}` : "someone you invited");
  await db
    .insert(accountCredits)
    .values([
      { id: nanoid(), userId: referral.referrerId, amountCents: REFERRAL_CREDIT_CENTS, reason: `Referral: ${who} started using Klik.`, referralId: referral.id },
      { id: nanoid(), userId, amountCents: REFERRAL_CREDIT_CENTS, reason: "Welcome credit for joining through a referral.", referralId: referral.id },
    ])
    .onConflictDoNothing();
  await Promise.all([
    recordAccountEvent({ userId: referral.referrerId, kind: "credit_added", detail: `${formatCents(REFERRAL_CREDIT_CENTS)} for referring ${who}.` }),
    recordAccountEvent({ userId, kind: "credit_added", detail: `${formatCents(REFERRAL_CREDIT_CENTS)} welcome credit from a referral.` }),
  ]);
  return { referrerId: referral.referrerId };
}

export async function creditBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(sum(${accountCredits.amountCents}), 0)::int` })
    .from(accountCredits)
    .where(eq(accountCredits.userId, userId));
  return row?.total ?? 0;
}

export async function creditHistory(userId: string, limit = 20) {
  const rows = await db
    .select({ id: accountCredits.id, amountCents: accountCredits.amountCents, reason: accountCredits.reason, createdAt: accountCredits.createdAt })
    .from(accountCredits)
    .where(eq(accountCredits.userId, userId))
    .orderBy(desc(accountCredits.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * A superadmin uses some of an account's credit, with a reason (usually the
 * refund it became). Refused beyond the balance. Not atomic against a second
 * superadmin doing the same at the same moment; it is a manual, rare action.
 */
export async function spendCredit({
  userId,
  amountCents,
  reason,
  by,
}: {
  userId: string;
  amountCents: number;
  reason: string;
  by: { id: string; label: string | null };
}): Promise<{ ok: true; balanceCents: number } | { ok: false; error: string }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: "Enter an amount." };
  const balance = await creditBalance(userId);
  if (amountCents > balance) return { ok: false, error: `They have ${formatCents(balance)} of credit.` };
  await db.insert(accountCredits).values({ id: nanoid(), userId, amountCents: -amountCents, reason, createdBy: by.id });
  await recordAccountEvent({ userId, kind: "credit_used", detail: `${formatCents(amountCents)}: ${reason}`, actor: by });
  return { ok: true, balanceCents: balance - amountCents };
}

/** The account page's view: the link, how it is going, and the balance. */
export async function referralSummary(userId: string) {
  const [[account], [counts], balanceCents, history] = await Promise.all([
    db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({
        joined: sql<number>`count(*)::int`,
        qualified: sql<number>`count(${referrals.qualifiedAt})::int`,
      })
      .from(referrals)
      .where(eq(referrals.referrerId, userId)),
    creditBalance(userId),
    creditHistory(userId),
  ]);
  return {
    code: account?.code ?? null,
    joined: counts?.joined ?? 0,
    qualified: counts?.qualified ?? 0,
    balanceCents,
    history,
  };
}

/** ADM-2: credit owed across every account, and how many accounts hold some. */
export async function creditOwedTotals(): Promise<{ cents: number; accounts: number }> {
  const balances = db
    .select({ balance: sql<number>`sum(${accountCredits.amountCents})`.as("balance") })
    .from(accountCredits)
    .groupBy(accountCredits.userId)
    .as("balances");
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(sum(${balances.balance}) FILTER (WHERE ${balances.balance} > 0), 0)::int`,
      accounts: sql<number>`count(*) FILTER (WHERE ${balances.balance} > 0)::int`,
    })
    .from(balances);
  return { cents: row?.cents ?? 0, accounts: row?.accounts ?? 0 };
}
