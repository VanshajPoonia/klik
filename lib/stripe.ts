import Stripe from "stripe";
import { env } from "@/lib/env";
import type { PlanKey } from "@/lib/plans";

/**
 * The pinned API version carries the `custom_checkout_payment_form_preview=v1`
 * beta flag. Without the flag, `checkout.sessions.create` refuses `ui_mode:
 * "form"`, so the embedded form never receives a client secret to mount
 * against and the checkout page renders an empty frame with no error on it.
 */
export const STRIPE_API_VERSION: string =
  "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1";

let client: Stripe | null = null;

/**
 * Stripe stays an optional provider, in the same shape as Google and Resend in
 * `lib/env.ts`: the secret key is absent in most local setups and in every
 * environment that is not taking payments yet, and nothing else in Klik may
 * stop working because of that. Callers get `null` and answer 503, rather than
 * this module throwing while it is being imported and taking unrelated routes
 * down with it.
 */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      // The SDK types `apiVersion` as the single version it shipped against
      // (2026-09-30.endive here), which cannot express a dated version carrying
      // a preview flag. The cast is the only way to pin one, and it is why
      // STRIPE_API_VERSION is declared as a plain string above.
      apiVersion: STRIPE_API_VERSION as Stripe.StripeConfig["apiVersion"],
    });
  }
  return client;
}

/**
 * Which Stripe Price backs each Klik plan, and whether buying it is a one-off
 * charge or a subscription.
 *
 * The Price ID is read from the environment and never accepted from the client.
 * A request that names its own price is a request that names a cheaper one, and
 * the failure is invisible: the payment succeeds, the webhook grants the plan,
 * and only the Stripe balance disagrees.
 *
 * The mode is derived here rather than passed in for the same reason. Venue is
 * the only recurring plan today, and `subscription` against a one-time Price is
 * rejected by Stripe, so a mismatch would surface at checkout rather than in a
 * reconciliation weeks later.
 */
export function getPlanBilling(planKey: PlanKey): {
  mode: Stripe.Checkout.SessionCreateParams.Mode;
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
