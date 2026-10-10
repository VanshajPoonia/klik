-- PAY-5, PAY-8 and ADM-2: what a grant was paid, and a Venue grant's grace.
-- See ROADMAP.md and BILLING.md "The grant is manual". Re-runnable.

-- What the superadmin recorded as paid when granting: the list price by
-- default, 0 for a comp, null for grants made before this column (unknown).
-- Klik never charges anything itself; Stripe is the record of money, and this
-- is the record of what a human matched to it.
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "amount_cents" integer;

-- PAY-8: a Venue subscription whose payment failed keeps working for 7 days
-- (decision C-6). Set when a superadmin starts the grace, together with
-- `ends_at`; cleared, with `ends_at`, when payment is recorded.
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "grace_started_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_amount_check') THEN
    ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_amount_check" CHECK ("amount_cents" IS NULL OR "amount_cents" BETWEEN 0 AND 10000000);
  END IF;
END $$;
