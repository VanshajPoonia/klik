-- MED-8, for professionals: keep the camera's details on photos the team
-- uploads, with the location always removed. Off by default; Premium and
-- Venue. See lib/exif-scrub.ts. Re-runnable.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "keep_photo_details" boolean NOT NULL DEFAULT false;
