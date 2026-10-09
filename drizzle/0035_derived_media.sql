-- CAM-2: an edited photo is a new photo, never a change to the original.
-- This says which one it was made from. Re-runnable.

BEGIN;

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "derived_from_id" text REFERENCES "media"("id") ON DELETE SET NULL;

COMMIT;
