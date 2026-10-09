-- MED-4: albums become folders that nest. The table keeps its name; people see
-- "Folders". Re-runnable.

BEGIN;

-- SET NULL rather than CASCADE: the purge removes a folder 30 days after it
-- was trashed, and anything still live beneath it moves to the top level
-- rather than going with it.
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "parent_id" text REFERENCES "albums"("id") ON DELETE SET NULL;
-- Order among siblings. Ties fall back to created_at, so existing folders keep
-- the order they always had without a backfill.
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;
-- The host's choice of cover. Null means "the newest photo in it".
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "cover_media_id" text REFERENCES "media"("id") ON DELETE SET NULL;
-- Smart folders are AI-4's: a saved query rather than a place. Built for now
-- only as far as the columns, so that work does not need another migration.
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'manual';
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "query" jsonb;

ALTER TABLE "albums" DROP CONSTRAINT IF EXISTS "albums_kind_check";
ALTER TABLE "albums" ADD CONSTRAINT "albums_kind_check" CHECK ("kind" IN ('manual', 'smart'));

CREATE INDEX IF NOT EXISTS "albums_parent_idx" ON "albums" ("event_id", "parent_id") WHERE "deleted_at" IS NULL;

-- The shape of the tree, held here rather than in the routes, because a route
-- that forgets is how a folder ends up inside itself.
--
-- - A parent belongs to the same event and is a manual folder.
-- - No folder is its own ancestor.
-- - Nothing is deeper than three levels, counting the moved folder's whole
--   subtree, so moving a folder with children cannot push them past the limit.
--
-- Two moves at once could each pass against the tree as it was and together
-- make a loop, so the check takes a per-event lock first. Each query in the
-- function then reads the tree as the other move left it.
CREATE OR REPLACE FUNCTION albums_check_tree()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_event text;
  parent_kind text;
  parent_depth integer;
  makes_cycle boolean;
  height integer;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."parent_id" = NEW."id" THEN
    RAISE EXCEPTION 'album_cycle';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('albums:' || NEW."event_id"));

  SELECT "event_id", "kind" INTO parent_event, parent_kind FROM "albums" WHERE "id" = NEW."parent_id";
  IF parent_event IS NULL OR parent_event <> NEW."event_id" OR parent_kind <> 'manual' THEN
    RAISE EXCEPTION 'album_parent_invalid';
  END IF;

  WITH RECURSIVE up("id", "parent_id", "depth") AS (
    SELECT "id", "parent_id", 1 FROM "albums" WHERE "id" = NEW."parent_id"
    UNION ALL
    SELECT a."id", a."parent_id", up."depth" + 1
    FROM "albums" a JOIN up ON a."id" = up."parent_id"
    WHERE up."depth" < 16
  )
  SELECT max("depth"), bool_or("id" = NEW."id") INTO parent_depth, makes_cycle FROM up;
  IF makes_cycle THEN
    RAISE EXCEPTION 'album_cycle';
  END IF;

  -- Trashed descendants count too: restoring one does not pass through here.
  WITH RECURSIVE down("id", "h") AS (
    SELECT NEW."id", 1
    UNION ALL
    SELECT a."id", down."h" + 1
    FROM "albums" a JOIN down ON a."parent_id" = down."id"
    WHERE down."h" < 16 AND a."id" <> NEW."id"
  )
  SELECT max("h") INTO height FROM down;

  IF parent_depth + height > 3 THEN
    RAISE EXCEPTION 'album_too_deep';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "albums_check_tree" ON "albums";
CREATE TRIGGER "albums_check_tree"
BEFORE INSERT OR UPDATE OF "parent_id", "event_id" ON "albums"
FOR EACH ROW EXECUTE FUNCTION albums_check_tree();

COMMIT;
