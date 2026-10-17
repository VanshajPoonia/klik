-- MED-11: a guest hiding their own upload, and only undoing their own hiding.
-- See lib/media-access.ts and app/api/e/[slug]/me/media. Re-runnable.
--
-- `uploader_hidden` says the private visibility came from the guest who
-- uploaded it. A guest may show again only what they hid themselves: a photo
-- the host hid stays hidden whatever the guest does.
--
-- The guest route sets the column with the visibility. Every other writer (the
-- dashboard, bulk actions, any route added later) changes visibility without
-- touching it, and the trigger below then clears it, so the moment the team
-- decides a photo's visibility the decision is theirs and the guest's undo no
-- longer reaches it. A trigger rather than a rule in each route, because a new
-- route that forgot it would hand a hidden photo back to the guest.

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "uploader_hidden" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION media_uploader_hidden_follow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."visibility" IS DISTINCT FROM OLD."visibility"
     AND NEW."uploader_hidden" IS NOT DISTINCT FROM OLD."uploader_hidden" THEN
    NEW."uploader_hidden" := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "media_uploader_hidden_trigger" ON "media";
CREATE TRIGGER "media_uploader_hidden_trigger"
BEFORE UPDATE OF "visibility" ON "media"
FOR EACH ROW
EXECUTE FUNCTION media_uploader_hidden_follow();
