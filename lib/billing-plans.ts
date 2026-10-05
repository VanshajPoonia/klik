import { env } from "@/lib/env";
import type { PlanKey } from "@/lib/plans";

export type BillingMode = "payment" | "subscription";

/**
 * Which Stripe Price backs each plan, and whether buying it is a one-off charge
 * or a subscription.
 *
 * This lives apart from `lib/stripe.ts` so that a page only asking "can this be
 * bought" does not pull the Stripe SDK into its bundle. The marketing page is
 * the reason: it renders for every visitor and needs none of that.
 *
 * The Price ID comes from the environment and never from the client. A request
 * that names its own price is a request that names a cheaper one, and the
 * failure is invisible: the payment succeeds and only the balance disagrees.
 *
 * The mode is decided here rather than passed in, because Venue is the only
 * recurring plan and `subscription` against a one-time Price is rejected by
 * Stripe. Resolving both in one place means a mismatch surfaces at checkout
 * rather than in a reconciliation weeks later.
 */
export function getPlanBilling(planKey: PlanKey): {
  mode: BillingMode;
  priceId: string | undefined;
} {
  switch (planKey) {
    case "event":
      return { mode: "payment", priceId: env.STRIPE_PRICE_EVENT };
    case "premium":
      return { mode: "payment", priceId: env.STRIPE_PRICE_PREMIUM };
    case "venue":
      return { mode: "subscription", priceId: env.STRIPE_PRICE_VENUE_MONTHLY };
  }
}

/**
 * Whether this plan can actually be bought right now.
 *
 * Both halves matter. Without a secret key the checkout route cannot create a
 * session, and without that plan's Price it does not know what to charge. Either
 * way the answer is the same: do not offer a button that leads to an apology.
 *
 * This is what keeps the pricing page honest in an environment where Stripe is
 * not configured, which is every environment until the keys are set in Vercel.
 */
export function isPlanPurchasable(planKey: PlanKey): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && getPlanBilling(planKey).priceId);
}
