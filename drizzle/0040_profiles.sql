-- GRW-4: a public profile at /u/<username>. See ROADMAP.md GRW-4. Re-runnable.

-- Off until the account turns it on. The words are the account's own; the
-- website must be https, because it is a link on a page strangers open.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_public" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_bio" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_website" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_bio_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_profile_bio_check"
      CHECK ("profile_bio" IS NULL OR char_length("profile_bio") <= 280);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_website_check') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_profile_website_check"
      CHECK ("profile_website" IS NULL OR ("profile_website" ~ '^https://' AND char_length("profile_website") <= 300));
  END IF;
END $$;

-- Each event is listed only when its owner says so. A public gallery is not
-- the same as one its host wants to advertise, and the profile shows only
-- the event's name and date, never guests' photos (ROADMAP.md LAW-4).
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "show_on_profile" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "events_profile_idx"
ON "events" ("owner_id", "event_date" DESC)
WHERE "show_on_profile" AND "deleted_at" IS NULL;
