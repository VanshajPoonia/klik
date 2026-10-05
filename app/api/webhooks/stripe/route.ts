import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  recordCheckoutSession,
  recordRefund,
  recordSubscription,
  subscriptionIdFromInvoice,
} from "@/lib/billing";
import { stripeWebhookEvents } from "@/lib/schema";
import { getStripe } from "@/lib/stripe";

// Signature verification needs the raw bytes and the Node crypto that
// `stripe.webhooks.constructEvent` uses. The edge runtime gives neither.
export const runtime = "nodejs";

/**
 * The only trustworthy signal that money moved.
 *
 * The success the browser reports after confirming a payment is a claim made by
 * a client we do not control, so nothing is recorded from it. This route is
 * where a payment becomes a fact, which is why every line below is about not
 * trusting the request until it has proved itself.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    // 503 rather than 200: an unconfigured endpoint has not handled anything,
    // and Stripe should keep the event rather than consider it delivered.
    return NextResponse.json({ error: "Webhooks are not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // The RAW body. Parsing first and re-serialising changes the bytes, and the
  // signature is over the bytes, so the check would fail for reasons that look
  // nothing like the cause.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    // Anyone can POST here. Without a valid signature this is not from Stripe,
    // and the body is not evidence of anything.
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Claim the event before doing any work. Stripe delivers at least once, not
  // exactly once, and retries for days on a non-2xx, so a duplicate delivery is
  // normal rather than exceptional. The primary key does the excluding, which
  // means two concurrent deliveries cannot both win.
  const claimed = await db
    .insert(stripeWebhookEvents)
    .values({ stripeEventId: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ stripeEventId: stripeWebhookEvents.stripeEventId });

  if (claimed.length === 0) {
    // Already seen. Answer 200 so Stripe stops retrying something that is done.
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await recordCheckoutSession(event.data.object);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await recordSubscription(event.data.object);
        break;

      case "invoice.paid":
      case "invoice.payment_failed": {
        // The invoice carries the outcome but not the subscription's new state,
        // so the subscription is re-read rather than inferred from the invoice.
        const subscriptionId = subscriptionIdFromInvoice(event.data.object);
        if (subscriptionId) {
          await recordSubscription(await stripe.subscriptions.retrieve(subscriptionId));
        }
        break;
      }

      case "charge.refunded":
        await recordRefund(event.data.object);
        break;

      default:
        // Recorded as processed. An event type we do not handle is handled, in
        // the sense that there is nothing to do and Stripe should stop asking.
        break;
    }

    await db
      .update(stripeWebhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));

    return NextResponse.json({ received: true });
  } catch (cause) {
    // Record why, then release the claim so Stripe's retry can try again. A
    // failed event that keeps its claim is an event that never completes, and
    // the row left behind is the only trace of a payment that did not land.
    const message = cause instanceof Error ? cause.message : "Unknown error";
    await db
      .delete(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));
    await db
      .insert(stripeWebhookEvents)
      .values({ stripeEventId: event.id, type: event.type, error: message })
      .onConflictDoUpdate({
        target: stripeWebhookEvents.stripeEventId,
        set: { error: message, processedAt: null },
      });

    console.error("Stripe webhook failed", event.type, event.id, cause);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
