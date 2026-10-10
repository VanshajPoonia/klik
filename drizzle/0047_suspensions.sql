-- ADM-5: Klik can pause a gallery, and tell its organizer about a report.
-- Re-runnable. See lib/suspensions.ts.

-- While set, nobody but the event's team sees the gallery or can add to it,
-- and its share links open nothing. Nothing is deleted. The reason is what
-- the organizer is told, so it never holds Klik's internal notes.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "suspended_reason" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "suspended_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_suspension_check') THEN
    ALTER TABLE "events" ADD CONSTRAINT "events_suspension_check" CHECK (
      "suspended_at" IS NULL OR ("suspended_reason" IS NOT NULL AND length("suspended_reason") BETWEEN 10 AND 500)
    );
  END IF;
END $$;

-- The superadmin's list of paused galleries.
CREATE INDEX IF NOT EXISTS "events_suspended_idx" ON "events" ("suspended_at") WHERE "suspended_at" IS NOT NULL;

-- When Klik asked the organizer to look at a reported photo.
ALTER TABLE "media_reports" ADD COLUMN IF NOT EXISTS "organizer_notified_at" timestamp with time zone;
