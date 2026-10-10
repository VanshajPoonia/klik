-- TRS-3: the language a gallery speaks to guests. 'auto' follows each guest's
-- browser; a language sets it for everyone who has not chosen one themselves.
-- Re-runnable.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "guest_language" text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_guest_language_check') THEN
    ALTER TABLE "events" ADD CONSTRAINT "events_guest_language_check" CHECK ("guest_language" IN ('auto', 'en', 'es'));
  END IF;
END $$;
