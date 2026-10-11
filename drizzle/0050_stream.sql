-- OPS-1: videos transcoded by Cloudflare Stream for playback. See lib/stream.ts.
-- Re-runnable.

-- The Stream copy of a video, and where it is: 'pending' while Stream
-- encodes, 'ready' once it plays, 'failed' if it never will (the original in
-- R2 then plays as before). Null is a video never sent, or a photo.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "stream_uid" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "stream_state" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_stream_state_check') THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_stream_state_check"
      CHECK ("stream_state" IS NULL OR "stream_state" IN ('pending', 'ready', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_stream_uid_check') THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_stream_uid_check"
      CHECK ("stream_uid" IS NULL OR "stream_uid" ~ '^[0-9a-f]{32}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "media_stream_uid_idx" ON "media" ("stream_uid") WHERE "stream_uid" IS NOT NULL;

-- A Stream copy has to go wherever its video goes: erasure, the purge, an
-- event's cascade, and any delete written later. So the database queues it,
-- the way it keeps the usage counters, and the `stream.reap` job empties the
-- queue. A soft delete keeps the copy, since the video can still be restored.
CREATE TABLE IF NOT EXISTS "stream_deletions" (
  "uid" text PRIMARY KEY,
  "queued_at" timestamp with time zone NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION media_queue_stream_deletion() RETURNS trigger AS $$
BEGIN
  INSERT INTO "stream_deletions" ("uid") VALUES (OLD."stream_uid") ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "media_stream_deletion_trigger" ON "media";
CREATE TRIGGER "media_stream_deletion_trigger"
AFTER DELETE ON "media"
FOR EACH ROW
WHEN (OLD."stream_uid" IS NOT NULL)
EXECUTE FUNCTION media_queue_stream_deletion();

-- Secrets Klik makes for itself at a provider (Stream's signing key and
-- webhook secret), sealed with a key derived from AUTH_SECRET, so the
-- database alone cannot sign a playback token. See lib/sealed.ts.
CREATE TABLE IF NOT EXISTS "provider_secrets" (
  "name" text PRIMARY KEY,
  "sealed" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Open galleries hear when a video's Stream copy is ready, through the sync
-- they already run. The rest of the list is unchanged from 0039.
DROP TRIGGER IF EXISTS "media_changed_at_trigger" ON "media";
CREATE TRIGGER "media_changed_at_trigger"
BEFORE UPDATE ON "media"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."visibility" IS DISTINCT FROM NEW."visibility"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
  OR OLD."album_id" IS DISTINCT FROM NEW."album_id"
  OR OLD."thumb_pathname" IS DISTINCT FROM NEW."thumb_pathname"
  OR OLD."poster_pathname" IS DISTINCT FROM NEW."poster_pathname"
  OR OLD."reaction_count" IS DISTINCT FROM NEW."reaction_count"
  OR OLD."comment_count" IS DISTINCT FROM NEW."comment_count"
  OR OLD."blob_pathname" IS DISTINCT FROM NEW."blob_pathname"
  OR OLD."proof_released_at" IS DISTINCT FROM NEW."proof_released_at"
  OR OLD."stream_state" IS DISTINCT FROM NEW."stream_state"
)
EXECUTE FUNCTION media_stamp_changed_at();
