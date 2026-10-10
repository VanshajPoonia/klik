-- AI-7 and AI-8 without a model: what a photo looks like, measured once.
-- See lib/image-analysis.ts. Re-runnable.

-- A 64-bit difference hash, as 16 hex characters: near-identical frames sit a
-- few bits apart. Sharpness is the variance of the Laplacian on a 256-pixel
-- rendition, comparable between frames of one scene, not across events.
-- Brightness is the mean luminance from 0 to 1.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "perceptual_hash" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "sharpness" real;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "brightness" real;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "analyzed_at" timestamp with time zone;

-- AI-8: the host's word on a photo for the highlights, which beats any score.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "highlight" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_highlight_check') THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_highlight_check" CHECK ("highlight" IS NULL OR "highlight" IN ('pinned', 'excluded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_perceptual_hash_check') THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_perceptual_hash_check" CHECK ("perceptual_hash" IS NULL OR "perceptual_hash" ~ '^[0-9a-f]{16}$');
  END IF;
END $$;

-- The daily backfill finds photos still to be measured without a scan.
CREATE INDEX IF NOT EXISTS "media_unanalyzed_idx"
ON "media" ("created_at")
WHERE "analyzed_at" IS NULL AND "kind" = 'photo' AND "deleted_at" IS NULL;
