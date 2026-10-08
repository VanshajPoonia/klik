-- MED-8, the video half: whether a video's location metadata has been
-- removed. Photos never need this; they are re-encoded on upload.
--
--   NULL      a video uploaded before this existed, or any photo. The daily
--             backfill scrubs the videos.
--   pending   uploaded, not yet scrubbed. Played only to its uploader.
--   clean     scrubbed, or nothing was there to remove.
--   failed    could not be read as MP4 or QuickTime. Played only to its
--             uploader, because what it carries is unknown.
-- Re-runnable.

BEGIN;

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "metadata_state" text;
ALTER TABLE "media" DROP CONSTRAINT IF EXISTS "media_metadata_state_check";
ALTER TABLE "media" ADD CONSTRAINT "media_metadata_state_check"
  CHECK ("metadata_state" IS NULL OR "metadata_state" IN ('pending', 'clean', 'failed'));

-- The backfill's query: videos that still need doing.
CREATE INDEX IF NOT EXISTS "media_video_scrub_idx" ON "media" ("created_at")
  WHERE "kind" = 'video' AND ("metadata_state" IS NULL OR "metadata_state" = 'pending');

COMMIT;
