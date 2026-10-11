-- AI-2, AI-4, AI-6: what Klik's vision model made of a photo. See lib/vision.ts.
-- Re-runnable. Needs pgvector, which Neon has (0.8) and the test cluster
-- installs (scripts/test-db.sh).

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per described photo (or video, from its poster still). Its own
-- table rather than columns on media, because the embedding alone is 4 KB and
-- every gallery query reads whole media rows. Cascades with the photo, so
-- erasure and the purge reach it without knowing it exists.
--
-- state 'failed' is a photo the model could not describe after its retries,
-- kept so the daily backfill does not pay for it again every day.
CREATE TABLE IF NOT EXISTS "media_vision" (
  "media_id" text PRIMARY KEY REFERENCES "media"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "model" text NOT NULL,
  -- One plain sentence, for search and for the organizer to read. Never a
  -- name, an age or any other guess about who someone is (lib/vision.ts).
  "caption" text,
  -- From the fixed set in lib/vision.ts, for scenes and smart folders.
  "labels" text[] NOT NULL DEFAULT '{}',
  -- bge-m3 over the caption and labels, for search by meaning.
  "embedding" vector(1024),
  -- AI-6. 'clear', 'flagged' (held for the organizer, and in Klik's queue),
  -- or 'unclear' (the model would not describe it; held for the organizer).
  "safety" text,
  "safety_reasons" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_vision_state_check') THEN
    ALTER TABLE "media_vision" ADD CONSTRAINT "media_vision_state_check" CHECK ("state" IN ('done', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_vision_safety_check') THEN
    ALTER TABLE "media_vision" ADD CONSTRAINT "media_vision_safety_check"
      CHECK ("safety" IS NULL OR "safety" IN ('clear', 'flagged', 'unclear'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_vision_caption_check') THEN
    ALTER TABLE "media_vision" ADD CONSTRAINT "media_vision_caption_check"
      CHECK ("caption" IS NULL OR char_length("caption") <= 300);
  END IF;
  -- A described row has its words; a failed one has nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_vision_done_check') THEN
    ALTER TABLE "media_vision" ADD CONSTRAINT "media_vision_done_check"
      CHECK ("state" = 'failed' OR "safety" IS NOT NULL);
  END IF;
END $$;

-- Search and scenes are always within one event. No HNSW index: filtering by
-- event first and then measuring a few thousand vectors exactly is faster and
-- more accurate than an approximate index over every event's photos, which
-- would find the nearest photos anywhere and then throw most of them away.
CREATE INDEX IF NOT EXISTS "media_vision_event_idx" ON "media_vision" ("event_id");
CREATE INDEX IF NOT EXISTS "media_vision_labels_idx" ON "media_vision" USING gin ("labels");

-- AI-2: guests get search and scenes unless the host turns them off. The
-- team always has them.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "scenes_enabled" boolean NOT NULL DEFAULT true;
