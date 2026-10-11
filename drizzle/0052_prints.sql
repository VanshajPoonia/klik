-- GRW-6: prints ordered from a gallery, paid through Stripe's hosted checkout
-- and sent to Prodigi by a person. See lib/prints.ts and BILLING.md. Re-runnable.

CREATE TABLE IF NOT EXISTS "print_orders" (
  "id" text PRIMARY KEY,
  -- Kept when the event or the buyer goes, for the books; what identifies a
  -- person (email, address) is cleared on its own schedule (redacted_at).
  "event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'awaiting_payment',
  -- [{ mediaId, product, copies, unitCents }], priced when ordered.
  "items" jsonb NOT NULL,
  "subtotal_cents" integer NOT NULL,
  "shipping_cents" integer NOT NULL,
  "tax_cents" integer NOT NULL DEFAULT 0,
  "total_cents" integer NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'usd',
  -- Filled from Stripe once paid.
  "email" text,
  "recipient" jsonb,
  "stripe_session_id" text,
  "stripe_payment_intent_id" text,
  -- Filled once a person sends it to the printer.
  "prodigi_order_id" text,
  "prodigi_stage" text,
  "tracking" jsonb,
  -- Prodigi's callbacks carry no signature, so each order's callback URL
  -- carries a secret of its own.
  "callback_token" text NOT NULL,
  "reviewed_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "paid_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "shipped_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "redacted_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_orders_status_check') THEN
    ALTER TABLE "print_orders" ADD CONSTRAINT "print_orders_status_check" CHECK ("status" IN (
      'awaiting_payment', 'paid', 'submitted', 'shipped', 'cancelled', 'refunded', 'expired', 'failed'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_orders_money_check') THEN
    ALTER TABLE "print_orders" ADD CONSTRAINT "print_orders_money_check" CHECK (
      "subtotal_cents" >= 0 AND "shipping_cents" >= 0 AND "tax_cents" >= 0 AND "total_cents" >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_orders_note_check') THEN
    ALTER TABLE "print_orders" ADD CONSTRAINT "print_orders_note_check" CHECK (
      ("note" IS NULL OR char_length("note") <= 500) AND ("error" IS NULL OR char_length("error") <= 500)
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "print_orders_session_idx" ON "print_orders" ("stripe_session_id") WHERE "stripe_session_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "print_orders_prodigi_idx" ON "print_orders" ("prodigi_order_id") WHERE "prodigi_order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "print_orders_status_idx" ON "print_orders" ("status", "created_at");

-- The host's switch. On by default: it only offers, and only appears once
-- prints are switched on for Klik as a whole.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "prints_enabled" boolean NOT NULL DEFAULT true;
