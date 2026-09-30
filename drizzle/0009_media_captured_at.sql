-- Keep the one piece of EXIF worth keeping. See ROADMAP.md MED-8.

-- The upload pipeline strips metadata, correctly: a camera JPEG carries GPS
-- coordinates, a device serial and often the owner's name. Verified rather
-- than assumed, because an earlier version of the roadmap claimed the opposite:
-- sharp discards EXIF unless .withMetadata() is called, and nothing in
-- app/api/e/[slug]/media/route.ts calls it, so stored photos were already clean.
--
-- The casualty was the capture time. media.created_at is when a file reached
-- us, which can be days after the event, and AI-1 groups photos into moments
-- by when they were actually shot.
--
-- No time zone, on purpose. EXIF carries none, so storing an instant would
-- mean inventing one. This column holds the camera's own wall clock. The
-- photos being grouped were taken by people standing in the same room, so
-- their cameras agree with each other even when none agrees with UTC.
ALTER TABLE "media"
ADD COLUMN IF NOT EXISTS "captured_at" timestamp;

-- Deliberately NOT backfilled from created_at. Null means "we do not know when
-- this was taken", and upload time is a different fact that the row already
-- records. Copying one into the other would turn an honest gap into a
-- confident wrong answer, and AI-1 would cluster on it.

-- Ordering photos within one event by when they were shot, which is the only
-- query this column exists to serve. Partial because a gallery never reads
-- soft-deleted rows, matching the shape used in 0007.
CREATE INDEX IF NOT EXISTS "media_event_captured_idx"
ON "media" ("event_id", "captured_at")
WHERE "deleted_at" IS NULL AND "captured_at" IS NOT NULL;
