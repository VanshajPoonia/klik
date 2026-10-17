-- MED-16: a host puts the photos in a folder in their own order. See
-- lib/folder-order.ts. Re-runnable.
--
-- folder_position is a photo's place in its own folder, smallest first; null
-- is "no place given", which sorts after every arranged photo in the order
-- there would otherwise be. A photo that changes folder loses its place in
-- the old one, here rather than in every route that can move a photo.

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "folder_position" integer;

CREATE OR REPLACE FUNCTION media_folder_position_follow() RETURNS trigger AS $$
BEGIN
  IF NEW.album_id IS DISTINCT FROM OLD.album_id THEN
    NEW.folder_position := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_folder_position_follow ON "media";
CREATE TRIGGER media_folder_position_follow
  BEFORE UPDATE OF album_id ON "media"
  FOR EACH ROW EXECUTE FUNCTION media_folder_position_follow();

-- A new order reaches open galleries through the same sync as any other
-- change to a photo (drizzle/0017_gallery_sync.sql): the list of columns that
-- stamp changed_at, as 0050_stream.sql left it, plus folder_position.
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
  OR OLD."folder_position" IS DISTINCT FROM NEW."folder_position"
)
EXECUTE FUNCTION media_stamp_changed_at();
