-- MED-12: folders the host keeps to the event's team. See lib/media-access.ts
-- and lib/folders.ts. Re-runnable.
--
-- `albums.team_only` is the host's switch. What the access rule reads is
-- `media.folder_hidden`: whether the photo's folder, or any folder above it,
-- is team-only. Kept on the photo by the triggers below, so the rule stays a
-- check on one row (the content route has one row in hand) and the gallery
-- query needs no recursive join.
--
-- A trashed team-only folder still hides its photos: un-hiding a folder's
-- photos by deleting the folder would be the surprising direction.
--
-- A folder share link still opens a team-only folder's photos, because the
-- link is the grant. That is how a host shares one folder with particular
-- people and nobody else.

ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "team_only" boolean NOT NULL DEFAULT false;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "folder_hidden" boolean NOT NULL DEFAULT false;

-- True when the folder or any folder above it is team-only.
CREATE OR REPLACE FUNCTION album_hidden(album text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE up AS (
    SELECT "id", "parent_id", "team_only", 1 AS depth FROM "albums" WHERE "id" = album
    UNION ALL
    SELECT a."id", a."parent_id", a."team_only", up.depth + 1
    FROM "albums" a JOIN up ON a."id" = up."parent_id"
    WHERE up.depth < 10
  )
  SELECT coalesce(bool_or("team_only"), false) FROM up
$$;

-- A photo filed, or refiled, takes its folder's state.
CREATE OR REPLACE FUNCTION media_folder_hidden_follow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."folder_hidden" := coalesce(album_hidden(NEW."album_id"), false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "media_folder_hidden_insert" ON "media";
CREATE TRIGGER "media_folder_hidden_insert"
BEFORE INSERT ON "media"
FOR EACH ROW
WHEN (NEW."album_id" IS NOT NULL)
EXECUTE FUNCTION media_folder_hidden_follow();

DROP TRIGGER IF EXISTS "media_folder_hidden_update" ON "media";
CREATE TRIGGER "media_folder_hidden_update"
BEFORE UPDATE OF "album_id" ON "media"
FOR EACH ROW
WHEN (OLD."album_id" IS DISTINCT FROM NEW."album_id")
EXECUTE FUNCTION media_folder_hidden_follow();

-- A folder switched, or moved under another, re-reads every photo filed in
-- the event, and stamps changed_at on the ones that flip so phones hear of it.
CREATE OR REPLACE FUNCTION albums_folder_hidden_cascade()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "media" m
  SET "folder_hidden" = coalesce(album_hidden(m."album_id"), false), "changed_at" = now()
  WHERE m."event_id" = NEW."event_id"
    AND m."album_id" IS NOT NULL
    AND m."folder_hidden" IS DISTINCT FROM coalesce(album_hidden(m."album_id"), false);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "albums_folder_hidden_cascade" ON "albums";
CREATE TRIGGER "albums_folder_hidden_cascade"
AFTER UPDATE OF "team_only", "parent_id" ON "albums"
FOR EACH ROW
WHEN (OLD."team_only" IS DISTINCT FROM NEW."team_only" OR OLD."parent_id" IS DISTINCT FROM NEW."parent_id")
EXECUTE FUNCTION albums_folder_hidden_cascade();
