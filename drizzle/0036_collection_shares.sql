-- Share links for a folder and for a hand-picked selection. See ROADMAP.md
-- MED-2 (album scope), MED-4 and MED-5.
--
-- A folder link ('album' scope) already fits the table from 0011: it points at
-- one folder through album_id, and what it shows is worked out when it is
-- opened, so photos added to the folder later appear through it.
--
-- A selection cannot point at one row. Photos live in one folder each
-- (media.album_id), so a selection is not a folder, and making a hidden folder
-- for it would move the photos out of the host's own. It is a list of photos,
-- fixed when the link is made, held in media_share_items.

ALTER TABLE "media_shares" DROP CONSTRAINT IF EXISTS "media_shares_scope_check";
ALTER TABLE "media_shares" ADD CONSTRAINT "media_shares_scope_check"
CHECK ("scope" IN ('media', 'album', 'event', 'selection'));

ALTER TABLE "media_shares" DROP CONSTRAINT IF EXISTS "media_shares_target_check";
ALTER TABLE "media_shares" ADD CONSTRAINT "media_shares_target_check"
CHECK (
  ("scope" = 'media'     AND "media_id" IS NOT NULL AND "album_id" IS NULL) OR
  ("scope" = 'album'     AND "album_id" IS NOT NULL AND "media_id" IS NULL) OR
  ("scope" = 'event'     AND "media_id" IS NULL     AND "album_id" IS NULL) OR
  ("scope" = 'selection' AND "media_id" IS NULL     AND "album_id" IS NULL)
);

-- The photos in a selection link. Erasing a photo takes it out of every
-- selection it was in, through the cascade, with nothing to remember.
CREATE TABLE IF NOT EXISTS "media_share_items" (
  "share_id" text NOT NULL REFERENCES "media_shares"("id") ON DELETE CASCADE,
  "media_id" text NOT NULL REFERENCES "media"("id") ON DELETE CASCADE,
  PRIMARY KEY ("share_id", "media_id")
);

-- The cascade from a deleted photo looks rows up by media_id.
CREATE INDEX IF NOT EXISTS "media_share_items_media_idx"
ON "media_share_items" ("media_id");

-- A folder's share sheet lists the links on that folder.
CREATE INDEX IF NOT EXISTS "media_shares_album_idx"
ON "media_shares" ("album_id")
WHERE "album_id" IS NOT NULL;
