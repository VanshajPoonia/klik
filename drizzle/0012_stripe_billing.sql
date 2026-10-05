-- Stripe bookkeeping. See ROADMAP.md PAY-2 and PAY-4.
--
-- These tables RECORD money. They do not grant capability. Granting stays with
-- the superadmin and `users.plan_key` until ACT-1 replaces it with the
-- entitlement ledger, because a webhook that writes capability directly is the
-- failure ROADMAP PAY-4 warns about: a comped venue silently downgraded when a
-- subscription lapses. Recording first means none of this has to be unpicked
-- when ACT-1 lands; the ledger reads from these rows rather than replacing them.

-- 1. The Stripe Customer behind an organizer.
--    One per user, so a returning buyer keeps their saved payment methods and
--    appears once in the Stripe Dashboard rather than once per purchase.
CREATE TABLE IF NOT EXISTS "stripe_customers" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. One-time purchases: Klik Event and Klik Premium.
--
--    `consumed_at` null means an unused pass. A pass is bought BEFORE the event
--    exists (PAY-2), so `event_id` is null until someone applies it, which is
--    also what lets an organizer buy three up front.
--
--    `stripe_checkout_session_id` is UNIQUE and that is the idempotency key for
--    fulfilment. Stripe retries webhooks, and without this a retry grants a
--    second pass for one payment.
CREATE TABLE IF NOT EXISTS "purchases" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "stripe_checkout_session_id" text NOT NULL UNIQUE,
  "stripe_payment_intent_id" text,
  "plan_key" text NOT NULL,
  -- Integer minor units, never a float. 0.1 + 0.2 is not 0.3 and money is not
  -- the place to discover that.
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "status" text NOT NULL DEFAULT 'paid',
  "consumed_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_plan_key_check";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_plan_key_check"
CHECK ("plan_key" IN ('event', 'premium', 'venue'));

ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_status_check";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_check"
CHECK ("status" IN ('paid', 'refunded'));

-- The admin question this answers is "who has paid and is still waiting", so
-- the index is partial on exactly that and stays small as paid passes are used.
CREATE INDEX IF NOT EXISTS "purchases_unconsumed_idx"
ON "purchases" ("user_id", "created_at")
WHERE "consumed_at" IS NULL AND "status" = 'paid';

-- 3. Recurring subscriptions: Klik Venue.
--
--    `status` deliberately carries NO check constraint. The vocabulary is
--    Stripe's (active, past_due, canceled, incomplete, trialing, paused, and
--    whatever they add next), and a value we have not seen must be stored, not
--    rejected. A webhook that 500s on an unknown status is retried forever and
--    the real state never lands.
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "stripe_subscription_id" text NOT NULL UNIQUE,
  "plan_key" text NOT NULL,
  "status" text NOT NULL,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_plan_key_check";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_key_check"
CHECK ("plan_key" IN ('event', 'premium', 'venue'));

CREATE INDEX IF NOT EXISTS "subscriptions_user_idx"
ON "subscriptions" ("user_id", "status");

-- 4. The idempotency ledger.
--
--    Stripe delivers at least once, not exactly once, and retries for days on a
--    non-2xx. Every handler claims its event here FIRST and skips if the row
--    already exists, so a duplicate delivery is a no-op rather than a second
--    purchase. `error` holds the last failure so a stuck event is findable
--    without reading logs.
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "stripe_event_id" text PRIMARY KEY,
  "type" text NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone,
  "error" text
);

-- Finding events that arrived and never completed, which is the only query this
-- table exists to answer at 2am.
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_unprocessed_idx"
ON "stripe_webhook_events" ("received_at")
WHERE "processed_at" IS NULL;
