-- Per-photo visibility and share links. See ROADMAP.md MED-1, MED-2, MED-3.

-- 1. Visibility, which is ORTHOGONAL to status.
--    status answers "has a moderator approved this". visibility answers "who is
--    it for". A photo can be approved and private, and conflating the two would
--    mean hiding a photo put it back in the moderation queue.
--
--    gallery: everyone with gallery access sees it. The default, and what every
--             existing row already is.
--    private: event managers only, plus the uploader when the event allows it.
--    link:    hidden from the grid, reachable only through an active share link.
ALTER TABLE "media"
ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'gallery';

ALTER TABLE "media" DROP CONSTRAINT IF EXISTS "media_visibility_check";
ALTER TABLE "media" ADD CONSTRAINT "media_visibility_check"
CHECK ("visibility" IN ('gallery', 'private', 'link'));

-- Grid queries filter on (event, status, visibility) together, and partial so
-- the index stays small, matching the shape used in 0007.
CREATE INDEX IF NOT EXISTS "media_event_visibility_idx"
ON "media" ("event_id", "visibility", "created_at")
WHERE "deleted_at" IS NULL;

-- 2. Whether a guest keeps seeing their own upload after it is made private.
--    Default true because the alternative is cruel: someone uploads a photo,
--    the host hides it, and from the guest's side their photo silently vanished
--    with no explanation. Hosts who need a true back room can turn it off.
ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "uploader_sees_own_private" boolean NOT NULL DEFAULT true;

-- 3. Share links.
--    media_id, album_id and scope are deliberately separate rather than one
--    polymorphic target column, so the foreign keys still do their job and a
--    deleted photo takes its links with it.
CREATE TABLE IF NOT EXISTS "media_shares" (
  "id" text PRIMARY KEY,
  -- Looked up by token alone, so it must reveal nothing about what it points
  -- at: no event slug, no media id. 22 characters of nanoid.
  "token" text NOT NULL UNIQUE,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "media_id" text REFERENCES "media"("id") ON DELETE CASCADE,
  "album_id" text REFERENCES "albums"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "allow_download" boolean NOT NULL DEFAULT false,
  "password_hash" text,
  "expires_at" timestamp with time zone,
  "max_views" integer,
  "view_count" integer NOT NULL DEFAULT 0,
  -- Revocation is instant and permanent. Not a soft delete: a revoked link is
  -- kept precisely so the record of it having existed survives.
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "media_shares" DROP CONSTRAINT IF EXISTS "media_shares_scope_check";
ALTER TABLE "media_shares" ADD CONSTRAINT "media_shares_scope_check"
CHECK ("scope" IN ('media', 'album', 'event'));

-- A scope must actually point at the thing it claims to scope.
ALTER TABLE "media_shares" DROP CONSTRAINT IF EXISTS "media_shares_target_check";
ALTER TABLE "media_shares" ADD CONSTRAINT "media_shares_target_check"
CHECK (
  ("scope" = 'media'  AND "media_id" IS NOT NULL AND "album_id" IS NULL) OR
  ("scope" = 'album'  AND "album_id" IS NOT NULL AND "media_id" IS NULL) OR
  ("scope" = 'event'  AND "media_id" IS NULL     AND "album_id" IS NULL)
);

-- The organizer-facing list: every link on an event, newest first.
CREATE INDEX IF NOT EXISTS "media_shares_event_idx"
ON "media_shares" ("event_id", "created_at" DESC);

-- The per-photo share sheet, and only links that still work.
CREATE INDEX IF NOT EXISTS "media_shares_media_idx"
ON "media_shares" ("media_id")
WHERE "revoked_at" IS NULL;
