-- GRW-3: photo challenges. Prompts the host sets ("a photo with someone you
-- just met"), which guests take on from the gallery, and an optional
-- leaderboard of who has shared most. Re-runnable.

BEGIN;

-- Soft-deleted, so a photo taken for a prompt the host later removed keeps
-- pointing at something rather than at nothing.
CREATE TABLE IF NOT EXISTS "challenges" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "prompt" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "challenges_event_idx" ON "challenges" ("event_id") WHERE "deleted_at" IS NULL;

-- The challenge a photo was taken for. Set when it is uploaded, never after.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "challenge_id" text REFERENCES "challenges"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "media_challenge_idx" ON "media" ("event_id", "challenge_id") WHERE "challenge_id" IS NOT NULL;

-- Off until the host turns it on: it puts guests' display names in front of
-- everyone, ranked.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "leaderboard_enabled" boolean NOT NULL DEFAULT false;

COMMIT;
