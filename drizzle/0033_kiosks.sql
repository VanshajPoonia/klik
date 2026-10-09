-- VEN-2: kiosk mode. A tablet at the venue that only takes photos.
-- Re-runnable.

BEGIN;

-- One row per kiosk device. Its uploads are a guest's like any other, so they
-- pass moderation, count against storage and can be reported and erased; the
-- guest row is the kiosk's identity, and it goes when the kiosk does.
--
-- Pairing is a one-time code, stored only as a SHA-256 hash, that expires in
-- thirty minutes and is cleared when a tablet uses it. Revoking a kiosk shuts
-- its tablet out at the next request, because every request from a kiosk
-- checks this row.
CREATE TABLE IF NOT EXISTS "kiosks" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "guest_id" text NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  -- The folder its photos go into, when the event has folders.
  "album_id" text REFERENCES "albums"("id") ON DELETE SET NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "pair_code_hash" text,
  "pair_expires_at" timestamp with time zone,
  "paired_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "kiosks_event_idx" ON "kiosks" ("event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "kiosks_guest_idx" ON "kiosks" ("guest_id");
CREATE UNIQUE INDEX IF NOT EXISTS "kiosks_pair_code_idx" ON "kiosks" ("pair_code_hash") WHERE "pair_code_hash" IS NOT NULL;

COMMIT;
