-- MED-15: guests make folders of their own. See app/api/e/[slug]/me/folders.
-- Re-runnable.
--
-- A folder a guest makes is an ordinary folder of the event: everyone sees it
-- once something is in it, anyone can file their own photos into it, and the
-- hosts rename, hide or delete it as they would their own. created_by_guest_id
-- only says who made it, for the dashboard and for the cap on how many one
-- guest may make. events.guest_folders is the host's switch, on by default.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "guest_folders" boolean NOT NULL DEFAULT true;
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "created_by_guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "albums_created_by_guest_idx" ON "albums" ("created_by_guest_id") WHERE "created_by_guest_id" IS NOT NULL;
