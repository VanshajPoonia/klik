-- F-4: what each event stores, kept by triggers so no upload or delete path can
-- forget to count. PAY-7 and SEC-1 bookkeeping alongside. Re-runnable.

BEGIN;

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "media_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "media_bytes" bigint NOT NULL DEFAULT 0;
-- The highest storage warning already sent (75, 90 or 100), so each is sent once.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "usage_warned_percent" integer NOT NULL DEFAULT 0;
-- The nearest retention warning already sent (30, 7 or 1 days), null for none.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "retention_warned_days" integer;

-- Live media only: what is in the trash still costs storage, but it is not
-- what the organizer sees in their gallery or can be asked to make room in,
-- and it is gone within 30 days.
CREATE OR REPLACE FUNCTION media_usage_on_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "events" e
  SET "media_count" = e."media_count" + d.c, "media_bytes" = e."media_bytes" + d.b
  FROM (
    SELECT "event_id", count(*) AS c, COALESCE(sum("size_bytes"), 0) AS b
    FROM added_rows WHERE "deleted_at" IS NULL GROUP BY "event_id"
  ) d
  WHERE e."id" = d."event_id";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION media_usage_on_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "events" e
  SET "media_count" = GREATEST(0, e."media_count" - d.c), "media_bytes" = GREATEST(0, e."media_bytes" - d.b)
  FROM (
    SELECT "event_id", count(*) AS c, COALESCE(sum("size_bytes"), 0) AS b
    FROM removed_rows WHERE "deleted_at" IS NULL GROUP BY "event_id"
  ) d
  WHERE e."id" = d."event_id";
  RETURN NULL;
END;
$$;

-- An update counts as the old row leaving and the new one arriving, so a soft
-- delete, a restore and a re-encode that changed the size are all one rule.
CREATE OR REPLACE FUNCTION media_usage_on_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "events" e
  SET "media_count" = GREATEST(0, e."media_count" + d.c), "media_bytes" = GREATEST(0, e."media_bytes" + d.b)
  FROM (
    SELECT "event_id", sum(c) AS c, sum(b) AS b FROM (
      SELECT "event_id", count(*) AS c, COALESCE(sum("size_bytes"), 0) AS b
      FROM new_rows WHERE "deleted_at" IS NULL GROUP BY "event_id"
      UNION ALL
      SELECT "event_id", -count(*) AS c, -COALESCE(sum("size_bytes"), 0) AS b
      FROM old_rows WHERE "deleted_at" IS NULL GROUP BY "event_id"
    ) both_sides
    GROUP BY "event_id"
  ) d
  WHERE e."id" = d."event_id" AND (d.c <> 0 OR d.b <> 0);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "media_usage_insert" ON "media";
CREATE TRIGGER "media_usage_insert" AFTER INSERT ON "media"
REFERENCING NEW TABLE AS added_rows FOR EACH STATEMENT EXECUTE FUNCTION media_usage_on_insert();

DROP TRIGGER IF EXISTS "media_usage_delete" ON "media";
CREATE TRIGGER "media_usage_delete" AFTER DELETE ON "media"
REFERENCING OLD TABLE AS removed_rows FOR EACH STATEMENT EXECUTE FUNCTION media_usage_on_delete();

DROP TRIGGER IF EXISTS "media_usage_update" ON "media";
CREATE TRIGGER "media_usage_update" AFTER UPDATE ON "media"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION media_usage_on_update();

-- Backfill from what is there now. Also what the nightly reconcile does.
UPDATE "events" e
SET "media_count" = COALESCE(s.c, 0), "media_bytes" = COALESCE(s.b, 0)
FROM (
  SELECT ev."id", count(m."id") AS c, sum(m."size_bytes") AS b
  FROM "events" ev
  LEFT JOIN "media" m ON m."event_id" = ev."id" AND m."deleted_at" IS NULL
  GROUP BY ev."id"
) s
WHERE e."id" = s."id";

COMMIT;
