import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOrCreateStripeCustomer } from "@/lib/billing";
import { PLAN_KEYS } from "@/lib/plans";
import { getPlanBilling, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

const requestSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
});

/**
 * Creates the Checkout Session that the embedded form on `/checkout` mounts
 * against, and returns its client secret as JSON.
 *
 * It deliberately does not redirect to `session.url`. The form renders inside a
 * Stripe-hosted iframe on a Klik page, so a 303 would navigate the whole tab to
 * Stripe's own hosted page and quietly replace the integration with a different
 * one that happens to still take money, which is the hardest kind of bug to
 * notice in review.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid plan" }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const planKey = parsed.data.planKey;
  const { mode, priceId } = getPlanBilling(planKey);
  if (!priceId) {
    return NextResponse.json({ error: "That plan is not available to buy yet" }, { status: 503 });
  }

  const userId = session.user.id;
  const customerId = await getOrCreateStripeCustomer(stripe, userId);

  const params: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "form",
    mode,
    customer: customerId,
    // Who bought it and what they bought, carried on the session so the webhook
    // does not have to guess. The webhook is the only trustworthy signal that
    // money moved, and it arrives with no browser session attached to it.
    client_reference_id: userId,
    metadata: { klik_user_id: userId, plan_key: planKey },
    line_items: [{ price: priceId, quantity: 1 }],
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: "auto",
    name_collection: { individual: { enabled: true, optional: true } },
    saved_payment_method_options: { payment_method_save: "enabled" },
    integration_identifier: "custom_embedded_web_0001",
  };

  if (mode === "subscription") {
    // Only meaningful for recurring billing. Sending it in payment mode is an
    // error from Stripe, not a silent no-op, so it stays behind the check.
    params.payment_method_collection = "always";
    // The subscription is a separate object and does not inherit the session's
    // metadata. Without this, `customer.subscription.created` arrives with no
    // way of knowing whose it is.
    params.subscription_data = {
      metadata: { klik_user_id: userId, plan_key: planKey },
    };
  }

  const checkoutSession = await stripe.checkout.sessions.create(params);
  return NextResponse.json({ client_secret: checkoutSession.client_secret });
}
