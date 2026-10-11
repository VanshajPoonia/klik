-- VEN-3: a venue's own domain (photos.thevenue.com) serving its galleries.
-- See lib/custom-domains.ts. Re-runnable.

CREATE TABLE IF NOT EXISTS "custom_domains" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hostname" text NOT NULL,
  -- Vercel's word that the domain may be used on this project (a TXT record
  -- when the domain is already claimed elsewhere on Vercel).
  "verified" boolean NOT NULL DEFAULT false,
  -- Vercel's word that DNS points at it and a certificate can be issued.
  "configured" boolean NOT NULL DEFAULT false,
  -- What to show the venue: the TXT challenge, and the A or CNAME record.
  "verification" jsonb,
  "records" jsonb,
  "checked_at" timestamp with time zone,
  "active_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_domains_hostname_check') THEN
    ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_hostname_check" CHECK (
      char_length("hostname") <= 253
      AND "hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "custom_domains_hostname_idx" ON "custom_domains" ("hostname");
-- One per venue account.
CREATE UNIQUE INDEX IF NOT EXISTS "custom_domains_owner_idx" ON "custom_domains" ("owner_id");

-- A domain has to leave the Vercel project when its row goes, whichever way
-- it goes (removed, or the account erased), or Klik would keep answering for
-- somebody else's hostname. The database queues it; `domains.reap` removes it.
CREATE TABLE IF NOT EXISTS "domain_removals" (
  "hostname" text PRIMARY KEY,
  "queued_at" timestamp with time zone NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION custom_domains_queue_removal() RETURNS trigger AS $$
BEGIN
  INSERT INTO "domain_removals" ("hostname") VALUES (OLD."hostname") ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "custom_domains_removal_trigger" ON "custom_domains";
CREATE TRIGGER "custom_domains_removal_trigger"
AFTER DELETE ON "custom_domains"
FOR EACH ROW
EXECUTE FUNCTION custom_domains_queue_removal();
