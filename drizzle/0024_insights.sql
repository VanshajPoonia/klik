-- GRW-7: how many times the gallery was opened by someone other than its
-- team. Everything else the insights show is counted from existing rows.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "gallery_opens" integer NOT NULL DEFAULT 0;
