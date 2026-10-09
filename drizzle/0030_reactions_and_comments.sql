-- MED-9: hearts and comments on gallery media, each off until the host turns
-- it on. Counts are kept on the media row by triggers, so a grid never counts
-- rows to draw a number, and every change to a count reaches phones through
-- the same change stamp as everything else in the gallery. Re-runnable.

BEGIN;

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "reactions_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "comments_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "reaction_count" integer NOT NULL DEFAULT 0;
-- Visible comments only: a hidden one is not part of the conversation guests see.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "comment_count" integer NOT NULL DEFAULT 0;

-- A heart, from a guest or from an account (the host, viewing their own
-- gallery). `reactor` is one of the two ids with a prefix, so a single primary
-- key makes each person's heart unique whichever kind of person they are.
CREATE TABLE IF NOT EXISTS "media_reactions" (
  "media_id" text NOT NULL REFERENCES "media"("id") ON DELETE CASCADE,
  "reactor" text NOT NULL,
  "guest_id" text REFERENCES "guests"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'heart',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("media_id", "reactor", "kind")
);

ALTER TABLE "media_reactions" DROP CONSTRAINT IF EXISTS "media_reactions_kind_check";
ALTER TABLE "media_reactions" ADD CONSTRAINT "media_reactions_kind_check" CHECK ("kind" IN ('heart'));
ALTER TABLE "media_reactions" DROP CONSTRAINT IF EXISTS "media_reactions_reactor_check";
ALTER TABLE "media_reactions" ADD CONSTRAINT "media_reactions_reactor_check" CHECK (
  ("guest_id" IS NOT NULL AND "user_id" IS NULL AND "reactor" = 'g:' || "guest_id")
  OR ("user_id" IS NOT NULL AND "guest_id" IS NULL AND "reactor" = 'u:' || "user_id")
);
-- For the cascades: erasing a guest or an account finds their hearts by index.
CREATE INDEX IF NOT EXISTS "media_reactions_guest_idx" ON "media_reactions" ("guest_id") WHERE "guest_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "media_reactions_user_idx" ON "media_reactions" ("user_id") WHERE "user_id" IS NOT NULL;

-- A comment needs an account, so free text from strangers is never anonymous.
-- Hidden rather than deleted when the host or enough reports take it down, so
-- it can be shown again and Klik can still read what was reported.
CREATE TABLE IF NOT EXISTS "media_comments" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "media_id" text NOT NULL REFERENCES "media"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "hidden_at" timestamptz,
  "hidden_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "hidden_reason" text
);

ALTER TABLE "media_comments" DROP CONSTRAINT IF EXISTS "media_comments_body_check";
ALTER TABLE "media_comments" ADD CONSTRAINT "media_comments_body_check"
  CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "media_comments" DROP CONSTRAINT IF EXISTS "media_comments_hidden_check";
ALTER TABLE "media_comments" ADD CONSTRAINT "media_comments_hidden_check" CHECK (
  ("hidden_at" IS NULL AND "hidden_reason" IS NULL)
  OR ("hidden_at" IS NOT NULL AND "hidden_reason" IN ('host', 'reports', 'klik'))
);
CREATE INDEX IF NOT EXISTS "media_comments_media_idx" ON "media_comments" ("media_id", "created_at");
CREATE INDEX IF NOT EXISTS "media_comments_user_idx" ON "media_comments" ("user_id");
CREATE INDEX IF NOT EXISTS "media_comments_event_idx" ON "media_comments" ("event_id", "created_at");

-- Reports on comments. Their own table rather than rows in media_reports,
-- because three reports on a photo hide the photo, and three on a comment
-- under it must not.
CREATE TABLE IF NOT EXISTS "comment_reports" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "comment_id" text NOT NULL REFERENCES "media_comments"("id") ON DELETE CASCADE,
  "reporter_guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "reporter_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "reporter_key" text NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "resolved_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution" text
);

ALTER TABLE "comment_reports" DROP CONSTRAINT IF EXISTS "comment_reports_reason_check";
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reason_check"
  CHECK ("reason" IN ('child_safety', 'nudity', 'violence', 'harassment', 'privacy', 'copyright', 'spam', 'other'));
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reports_once_idx" ON "comment_reports" ("comment_id", "reporter_key");
CREATE INDEX IF NOT EXISTS "comment_reports_open_idx" ON "comment_reports" ("created_at")
  WHERE "resolved_at" IS NULL;
CREATE INDEX IF NOT EXISTS "comment_reports_event_idx" ON "comment_reports" ("event_id")
  WHERE "resolved_at" IS NULL;

-- Counters. Statement-level with transition tables, like the usage counters in
-- 0021, so an erasure that takes three hundred hearts with it updates each
-- photo once rather than once per heart.
CREATE OR REPLACE FUNCTION media_reactions_count_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "media" m SET "reaction_count" = m."reaction_count" + d.c
  FROM (SELECT "media_id", count(*) AS c FROM added_rows GROUP BY "media_id") d
  WHERE m."id" = d."media_id";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION media_reactions_count_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "media" m SET "reaction_count" = GREATEST(0, m."reaction_count" - d.c)
  FROM (SELECT "media_id", count(*) AS c FROM removed_rows GROUP BY "media_id") d
  WHERE m."id" = d."media_id";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "media_reactions_count_insert" ON "media_reactions";
CREATE TRIGGER "media_reactions_count_insert" AFTER INSERT ON "media_reactions"
REFERENCING NEW TABLE AS added_rows FOR EACH STATEMENT EXECUTE FUNCTION media_reactions_count_insert();

DROP TRIGGER IF EXISTS "media_reactions_count_delete" ON "media_reactions";
CREATE TRIGGER "media_reactions_count_delete" AFTER DELETE ON "media_reactions"
REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION media_reactions_count_delete();

CREATE OR REPLACE FUNCTION media_comments_count_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "media" m SET "comment_count" = m."comment_count" + d.c
  FROM (SELECT "media_id", count(*) AS c FROM added_rows WHERE "hidden_at" IS NULL GROUP BY "media_id") d
  WHERE m."id" = d."media_id";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION media_comments_count_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "media" m SET "comment_count" = GREATEST(0, m."comment_count" - d.c)
  FROM (SELECT "media_id", count(*) AS c FROM removed_rows WHERE "hidden_at" IS NULL GROUP BY "media_id") d
  WHERE m."id" = d."media_id";
  RETURN NULL;
END;
$$;

-- Hiding is the old visible row leaving; showing again is it coming back.
CREATE OR REPLACE FUNCTION media_comments_count_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "media" m SET "comment_count" = GREATEST(0, m."comment_count" + d.c)
  FROM (
    SELECT "media_id", sum(c) AS c FROM (
      SELECT "media_id", count(*) AS c FROM new_rows WHERE "hidden_at" IS NULL GROUP BY "media_id"
      UNION ALL
      SELECT "media_id", -count(*) AS c FROM old_rows WHERE "hidden_at" IS NULL GROUP BY "media_id"
    ) both_sides
    GROUP BY "media_id"
  ) d
  WHERE m."id" = d."media_id" AND d.c <> 0;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "media_comments_count_insert" ON "media_comments";
CREATE TRIGGER "media_comments_count_insert" AFTER INSERT ON "media_comments"
REFERENCING NEW TABLE AS added_rows FOR EACH STATEMENT EXECUTE FUNCTION media_comments_count_insert();

DROP TRIGGER IF EXISTS "media_comments_count_delete" ON "media_comments";
CREATE TRIGGER "media_comments_count_delete" AFTER DELETE ON "media_comments"
REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION media_comments_count_delete();

DROP TRIGGER IF EXISTS "media_comments_count_update" ON "media_comments";
CREATE TRIGGER "media_comments_count_update" AFTER UPDATE ON "media_comments"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION media_comments_count_update();

-- The change stamp from 0017, now also moved by a count. A heart is something
-- every viewer can see, so phones hear about it through the sync they already
-- run rather than through a second channel.
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
)
EXECUTE FUNCTION media_stamp_changed_at();

-- Backfill, which on a first run is all zeros, and on a re-run heals any drift.
UPDATE "media" m SET "reaction_count" = COALESCE(r.c, 0)
FROM "media" m2
LEFT JOIN (SELECT "media_id", count(*) AS c FROM "media_reactions" GROUP BY "media_id") r ON r."media_id" = m2."id"
WHERE m."id" = m2."id" AND m."reaction_count" IS DISTINCT FROM COALESCE(r.c, 0);

UPDATE "media" m SET "comment_count" = COALESCE(c.c, 0)
FROM "media" m2
LEFT JOIN (
  SELECT "media_id", count(*) AS c FROM "media_comments" WHERE "hidden_at" IS NULL GROUP BY "media_id"
) c ON c."media_id" = m2."id"
WHERE m."id" = m2."id" AND m."comment_count" IS DISTINCT FROM COALESCE(c.c, 0);

COMMIT;
