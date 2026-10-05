import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchases, subscriptions, users } from "@/lib/schema";

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
        planKey: users.planKey,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(and(eq(subscriptions.planKey, "venue"), ne(users.planKey, "venue")))
      .orderBy(desc(subscriptions.updatedAt)),
  ]);

  return {
    unusedPasses,
    venueDrift: venueDrift.filter((row) => PAYING_STATUSES.includes(row.status)),
  };
}
