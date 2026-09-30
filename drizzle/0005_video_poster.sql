-- Poster stills for video. See ROADMAP.md OPS-1 and SEC-7.
--
-- The gallery grid rendered <video preload="metadata"> per tile to show a first
-- frame. On iPhone .mov files the moov atom often sits at the END of the file,
-- so "just the metadata" meant reaching deep into a 200 MB recording, once per
-- visible video. The poster is extracted on the uploader's own device at upload
-- time and stored as a separate small object, so viewers load an image instead.
ALTER TABLE "media"
ADD COLUMN IF NOT EXISTS "poster_pathname" text;
