import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { entitlements, purchases, subscriptions, users } from "@/lib/schema";

/**
 * Subscription states that mean the money is currently arriving. Anything else,
 * including `past_due` and `unpaid`, is not a reason to revoke on its own: a
 * card that failed this morning is usually a card that works this afternoon,
 * and ROADMAP PAY-4 is explicit that a lapse must not silently downgrade.
 */
const PAYING_STATUSES = ["active", "trialing"];

/**
 * What a superadmin needs to see before deciding anything.
 *
 * Stripe records money, a human grants capability, and this is the join between
 * the two. It answers one question: whose payment has not yet been turned into
 * access, and whose access no longer matches what they are paying for.
 */
export async function getPendingActivations() {
  const [unusedPasses, venueDrift] = await Promise.all([
    // Paid and never applied to an event. The thing someone is waiting on.
    db
      .select({
        id: purchases.id,
        userId: purchases.userId,
        contactName: users.name,
        username: users.username,
        planKey: purchases.planKey,
        amountCents: purchases.amountCents,
        currency: purchases.currency,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .innerJoin(users, eq(users.id, purchases.userId))
      .where(and(eq(purchases.status, "paid"), isNull(purchases.consumedAt)))
      .orderBy(desc(purchases.createdAt)),

    // A live Venue subscription against an account that is not on Venue. The
    // reverse case, Venue access with no subscription, is left alone on
    // purpose: that is what an admin comp looks like, and flagging it would
    // train whoever reads this screen to ignore it.
    db
      .select({
        userId: subscriptions.userId,
        contactName: users.name,
        username: users.username,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      // Against the ledger since ACT-1: a paying Venue subscription with no
      // active Venue grant is somebody paying for something they do not have.
      .where(
        and(
          eq(subscriptions.planKey, "venue"),
          sql`NOT EXISTS (
            SELECT 1 FROM ${entitlements}
            WHERE ${entitlements.userId} = ${subscriptions.userId}
              AND ${entitlements.planKey} = 'venue'
              AND ${entitlements.status} = 'active'
          )`,
        ),
      )
      .orderBy(desc(subscriptions.updatedAt)),
  ]);

  return {
    unusedPasses,
    venueDrift: venueDrift.filter((row) => PAYING_STATUSES.includes(row.status)),
  };
}

/**
 * Accounts that signed themselves up and are waiting on a decision.
 *
 * This is the queue that `getPendingActivations` above cannot see. That one
 * reads `purchases`, which only the webhook writes, and the site sells through
 * Stripe-hosted Payment Links that reach no webhook at all, so it is empty and
 * will stay empty for as long as that is true (BILLING.md, "The Payment Links
 * are what the site actually uses").
 *
 * What a superadmin actually has is a payment in the Stripe Dashboard carrying
 * an email, and no way to find the matching Klik account, because the admin
 * client list is built from accounts that already have an event. A self-signup
 * has neither an event nor a plan, so it appeared nowhere. Hence the email in
 * this select: it is the only thing joining Stripe's record of the money to the
 * account that is owed something for it.
 */
export async function getPendingSignups() {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.role, "organizer"), isNull(users.activatedAt)))
    .orderBy(desc(users.createdAt));
}
