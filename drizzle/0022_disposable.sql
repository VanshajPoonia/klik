-- CAM-4: disposable camera mode. A roll of shots per guest, hidden from every
-- guest until it develops. Re-runnable.

BEGIN;

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "disposable_mode" boolean NOT NULL DEFAULT false;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "shots_per_guest" integer NOT NULL DEFAULT 24;
-- When the roll develops. Compared at read time rather than flipped by a job,
-- so it is exact to the second on any hosting plan. Null in disposable mode
-- means "when the host says so".
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "develops_at" timestamptz;

ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_shots_per_guest_check";
ALTER TABLE "events" ADD CONSTRAINT "events_shots_per_guest_check"
  CHECK ("shots_per_guest" BETWEEN 1 AND 200);

-- Shots a guest has used on this event's roll. Raised by a conditional update
-- at registration, so two uploads racing for the last shot cannot both get it.
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "shots_used" integer NOT NULL DEFAULT 0;

COMMIT;
