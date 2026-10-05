import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { auth } from "@/lib/auth";
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

  const { mode, priceId } = getPlanBilling(parsed.data.planKey);
  if (!priceId) {
    return NextResponse.json({ error: "That plan is not available to buy yet" }, { status: 503 });
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "form",
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: "auto",
    name_collection: { individual: { enabled: true, optional: true } },
    saved_payment_method_options: { payment_method_save: "enabled" },
    integration_identifier: "custom_embedded_web_0001",
  };

  // Only meaningful for recurring billing. Sending it in payment mode is an
  // error from Stripe, not a silent no-op, so it stays behind the check.
  if (mode === "subscription") {
    params.payment_method_collection = "always";
  }

  const checkoutSession = await stripe.checkout.sessions.create(params);
  return NextResponse.json({ client_secret: checkoutSession.client_secret });
}
