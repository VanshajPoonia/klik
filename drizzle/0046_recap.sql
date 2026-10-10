-- GRW-1: the morning-after recap. Re-runnable. See lib/recap.ts.

-- The host can stop guests being offered it. On by default: a guest still has
-- to ask, so on means "offered", never "sent".
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "recap_enabled" boolean NOT NULL DEFAULT true;

-- One guest's request. The address is held only until the one email goes:
-- sending sets recap_sent_at and clears recap_email, so Klik keeps when it
-- went and not where. recap_consent records which words were agreed to, in
-- the form lib/consent.ts uses ("<version>:<locale>").
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_email" text;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_consent" text;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_consented_at" timestamp with time zone;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_locale" text;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_due_at" timestamp with time zone;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_failures" smallint NOT NULL DEFAULT 0;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "recap_sent_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guests_recap_request_check') THEN
    -- An address is never held without the consent and the time it is for.
    ALTER TABLE "guests" ADD CONSTRAINT "guests_recap_request_check" CHECK (
      "recap_email" IS NULL OR (
        length("recap_email") <= 254
        AND "recap_consent" IS NOT NULL
        AND "recap_consented_at" IS NOT NULL
        AND "recap_due_at" IS NOT NULL
      )
    );
  END IF;
END $$;

-- What the send job and the daily backfill look for.
CREATE INDEX IF NOT EXISTS "guests_recap_due_idx"
ON "guests" ("recap_due_at")
WHERE "recap_email" IS NOT NULL AND "recap_sent_at" IS NULL;

-- Addresses that asked never to hear from Klik again. A SHA-256 of the
-- lower-cased address, never the address: enough to refuse a send, not
-- enough to read back who asked.
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "email_hash" text PRIMARY KEY CHECK ("email_hash" ~ '^[0-9a-f]{64}$'),
  "reason" text NOT NULL CHECK ("reason" IN ('unsubscribed', 'complained', 'bounced')),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
