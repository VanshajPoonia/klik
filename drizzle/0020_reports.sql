-- TRS-1: guests can report a photo, and a child-safety report puts it under a
-- legal hold that nothing in the app can delete through. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "media_reports" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "media_id" text NOT NULL REFERENCES "media"("id") ON DELETE CASCADE,
  "reporter_guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "reporter_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  -- Who reported, as a hash, so one person reporting twice is one report
  -- without keeping their identity in this table any longer than the row.
  "reporter_key" text NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "resolved_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution" text
);

ALTER TABLE "media_reports" DROP CONSTRAINT IF EXISTS "media_reports_reason_check";
ALTER TABLE "media_reports" ADD CONSTRAINT "media_reports_reason_check"
  CHECK ("reason" IN ('child_safety', 'nudity', 'violence', 'harassment', 'privacy', 'copyright', 'spam', 'other'));

CREATE UNIQUE INDEX IF NOT EXISTS "media_reports_once_idx" ON "media_reports" ("media_id", "reporter_key");
CREATE INDEX IF NOT EXISTS "media_reports_open_idx" ON "media_reports" ("created_at")
  WHERE "resolved_at" IS NULL;
CREATE INDEX IF NOT EXISTS "media_reports_event_idx" ON "media_reports" ("event_id")
  WHERE "resolved_at" IS NULL;

-- Set by a child-safety report. While set, the purge, erasure and a guest's own
-- delete all leave the row and its bytes alone: US law requires a provider to
-- preserve apparent child sexual abuse material it reports, and a 30-day purge
-- would otherwise destroy it. Only a superadmin clears it.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "legal_hold_at" timestamptz;
CREATE INDEX IF NOT EXISTS "media_legal_hold_idx" ON "media" ("event_id")
  WHERE "legal_hold_at" IS NOT NULL;

COMMIT;
