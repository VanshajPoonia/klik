import Stripe from "stripe";
import { env } from "@/lib/env";

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

// Re-exported so callers that already hold a Stripe client have one import,
// while the marketing page can reach the same answer without the SDK.
export { getPlanBilling, isPlanPurchasable } from "@/lib/billing-plans";
