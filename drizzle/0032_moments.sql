-- AI-1: moments and bursts, worked out from capture time by the
-- `moments.refresh` job (lib/job-handlers/moments.ts). Re-runnable.

BEGIN;

-- The moment a photo belongs to: an `albums` row of kind 'smart' whose query
-- says it is a moment. Separate from `album_id`, so a photo can be in a folder
-- and in a moment at once, which is the point of smart folders (AI-4).
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "moment_id" text REFERENCES "albums"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "media_moment_idx" ON "media" ("moment_id") WHERE "moment_id" IS NOT NULL;

-- The first photo of the burst this one is part of, which stands for the
-- burst in a grid. No foreign key: if that photo goes, the rest simply show
-- on their own until the next refresh picks a new first.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "burst_id" text;

-- Whether guests are shown the moments. The host always is.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "moments_enabled" boolean NOT NULL DEFAULT true;

COMMIT;
