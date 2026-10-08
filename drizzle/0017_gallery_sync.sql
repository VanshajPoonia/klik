-- Gallery read path: thumbnails, and change tracking so a polling gallery can
-- be told what moved instead of re-reading everything. Re-runnable, like every
-- migration here, because scripts/test-db.sh lays it over a pushed schema.

BEGIN;

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "thumb_pathname" text;

-- Backfilled from what we know, but only when the column is genuinely new. A
-- re-run must not rewrite real change times back to the creation time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'media' AND column_name = 'changed_at'
  ) THEN
    ALTER TABLE "media" ADD COLUMN "changed_at" timestamptz NOT NULL DEFAULT now();
    UPDATE "media" SET "changed_at" = GREATEST("created_at", COALESCE("deleted_at", "created_at"));
  END IF;
END $$;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "media_changed_at" timestamptz NOT NULL DEFAULT now();

-- What the changes endpoint scans: one event's rows, newest changes first.
-- Deliberately not partial on deleted_at: a deletion is itself a change that
-- a phone needs to hear about.
CREATE INDEX IF NOT EXISTS "media_event_changed_idx"
  ON "media" ("event_id", "changed_at");

-- 1. Stamp the row. Only when something a viewer can see actually changed, so
--    an UPDATE that rewrites a value to itself does not wake every phone.
CREATE OR REPLACE FUNCTION media_stamp_changed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."changed_at" := now();
  RETURN NEW;
END;
$$;

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
)
EXECUTE FUNCTION media_stamp_changed_at();

-- 2. Roll it up to the event. Statement-level with transition tables, so a
--    bulk restore of five hundred photos updates the event row once rather
--    than five hundred times.
CREATE OR REPLACE FUNCTION media_bump_event_on_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "events" SET "media_changed_at" = now()
  WHERE "id" IN (SELECT DISTINCT "event_id" FROM changed_rows);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "media_bump_event_insert" ON "media";
CREATE TRIGGER "media_bump_event_insert"
AFTER INSERT ON "media"
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION media_bump_event_on_write();

DROP TRIGGER IF EXISTS "media_bump_event_delete" ON "media";
CREATE TRIGGER "media_bump_event_delete"
AFTER DELETE ON "media"
REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT
EXECUTE FUNCTION media_bump_event_on_write();

-- Updates compare old and new, so only rows whose stamp moved count. The row
-- trigger above already decided what "moved" means; this reuses its verdict.
CREATE OR REPLACE FUNCTION media_bump_event_on_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "events" SET "media_changed_at" = now()
  WHERE "id" IN (
    SELECT DISTINCT n."event_id"
    FROM new_rows n
    JOIN old_rows o ON o."id" = n."id"
    WHERE n."changed_at" IS DISTINCT FROM o."changed_at"
       OR n."event_id" IS DISTINCT FROM o."event_id"
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "media_bump_event_update" ON "media";
CREATE TRIGGER "media_bump_event_update"
AFTER UPDATE ON "media"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION media_bump_event_on_update();

COMMIT;
