import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import type { PlanKey } from "@/lib/plans";
import { PLAN_KEYS } from "@/lib/plans";
import { purchases, stripeCustomers, subscriptions, users } from "@/lib/schema";

/**
 * Finds or creates the Stripe Customer for an organizer.
 *
 * One Customer per user, not per purchase. Without this a returning buyer gets
 * a fresh Customer every time, loses the saved payment methods Checkout Studio
 * was configured to offer, and appears in the Dashboard as a crowd of
 * strangers who happen to share an email.
 */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  userId: string,
): Promise<string> {
  const [existing] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, userId))
    .limit(1);
  if (existing) return existing.stripeCustomerId;

  const [account] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const customer = await stripe.customers.create({
    email: account?.email ?? undefined,
    name: account?.name ?? undefined,
    // The link back to Klik. Without it a Stripe-side investigation ends at an
    // email address, which is not a primary key here.
    metadata: { klik_user_id: userId },
  });

  // onConflictDoNothing, not an upsert: two tabs starting checkout at once both
  // reach this point, and the loser must keep the winner's customer rather than
  // overwrite it with the orphan it just made.
  await db
    .insert(stripeCustomers)
    .values({ userId, stripeCustomerId: customer.id })
    .onConflictDoNothing();

  const [settled] = await db
    .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, userId))
    .limit(1);
  return settled?.stripeCustomerId ?? customer.id;
}

function asPlanKey(value: string | null | undefined): PlanKey | null {
  return PLAN_KEYS.includes(value as PlanKey) ? (value as PlanKey) : null;
}

/**
 * Records a completed one-time purchase.
 *
 * Deliberately does not touch `users.planKey`. Recording that money arrived and
 * deciding what someone may do are different questions, and until ACT-1's
 * ledger exists the second is answered by a superadmin. A row here with
 * `consumedAt` null is what the admin panel shows as waiting to be activated.
 */
export async function recordCheckoutSession(session: Stripe.Checkout.Session) {
  // Subscriptions arrive through customer.subscription.*, which carries the
  // period and status this event does not.
  if (session.mode !== "payment") return;
  if (session.payment_status !== "paid") return;

  const userId = session.client_reference_id;
  const planKey = asPlanKey(session.metadata?.plan_key);
  if (!userId || !planKey) return;

  await db
    .insert(purchases)
    .values({
      id: nanoid(),
      userId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
      planKey,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      status: "paid",
    })
    // The unique checkout session id makes the retry a no-op. This is the line
    // that stops one payment becoming two passes.
    .onConflictDoNothing({ target: purchases.stripeCheckoutSessionId });
}

/**
 * Mirrors a Stripe subscription into the local table.
 *
 * Stripe is the source of truth for subscription state and this is a cache of
 * it, so every field is overwritten on every event. Events can arrive out of
 * order, which is why `updatedAt` is stamped rather than trusted.
 */
export async function recordSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.klik_user_id;
  const planKey = asPlanKey(subscription.metadata?.plan_key) ?? "venue";
  if (!userId) return;

  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end ?? null;

  const values = {
    planKey,
    status: subscription.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: new Date(),
  };

  await db
    .insert(subscriptions)
    .values({
      id: nanoid(),
      userId,
      stripeSubscriptionId: subscription.id,
      ...values,
    })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: values });
}

/**
 * Marks a purchase refunded.
 *
 * It does not revoke anything, for the same reason the paid path does not
 * grant: a refund is a fact about money, and whether the organizer keeps access
 * is a judgement a human makes. ROADMAP PAY-4 is explicit that a refund must
 * never delete media.
 */
export async function recordRefund(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  await db
    .update(purchases)
    .set({ status: "refunded", refundedAt: new Date() })
    .where(eq(purchases.stripePaymentIntentId, paymentIntentId));
}

/**
 * Where the subscription id lives on an invoice depends on the API version:
 * older shapes put it at the top level, newer ones only on the line items.
 * Reading both means pinning a different version does not silently stop
 * subscription invoices from updating anything.
 */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  if (typeof direct === "string") return direct;
  if (direct?.id) return direct.id;

  for (const line of invoice.lines?.data ?? []) {
    const parent = line.parent?.subscription_item_details?.subscription;
    if (typeof parent === "string") return parent;
    if (parent && typeof parent === "object" && "id" in parent) return (parent as { id: string }).id;
  }
  return null;
}
