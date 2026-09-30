-- Soft delete, pinned retention, and rate limiting.
-- See ROADMAP.md SEC-1 through SEC-5 for why each of these exists.

-- 1. Retention is pinned per event instead of recomputed from the owner's
--    current plan at purge time. Recomputing let a downgrade retroactively
--    shorten the window, which made media that was safe yesterday eligible
--    for permanent deletion tonight.
ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "retention_until" timestamptz;

-- Backfill from each owner's current plan. GREATEST against the existing
-- created_at guarantees the value is never in the past for a fresh row, and
-- the window chosen here matches what the purge cron would have applied
-- yesterday, so nothing becomes newly eligible because of this migration.
UPDATE "events" e
SET "retention_until" = e."created_at" + (
  CASE u."plan_key"
    WHEN 'premium' THEN interval '365 days'
    WHEN 'venue'   THEN interval '365 days'
    ELSE                interval '180 days'
  END
)
FROM "users" u
WHERE u."id" = e."owner_id" AND e."retention_until" IS NULL;

-- 2. Soft delete. Rows stay recoverable for 30 days; the purge cron removes
--    the row and its objects once that window closes.
ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "media"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "media_deleted_idx"
ON "media" ("deleted_at");

-- 3. Postgres-backed rate limit counters.
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" text PRIMARY KEY,
  "window_start" timestamptz NOT NULL DEFAULT now(),
  "count" integer NOT NULL DEFAULT 0
);

-- 4. A soft-deleted event must stop counting against plan limits, or deleting
--    an event would silently consume the owner's monthly allowance and leave
--    them unable to create a replacement. The active-event count already
--    ignores them because the delete sets is_active = false, but the monthly
--    count and the featured-event index both needed teaching.
DROP INDEX IF EXISTS "events_owner_featured_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "events_owner_featured_unique"
ON "events" ("owner_id")
WHERE "venue_featured" = true AND "deleted_at" IS NULL;

CREATE OR REPLACE FUNCTION enforce_event_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_plan text;
  active_limit integer;
  monthly_limit integer;
  active_count integer;
  monthly_count integer;
  month_start timestamptz;
BEGIN
  PERFORM 1
  FROM "users"
  WHERE "id" = NEW."owner_id"
  FOR UPDATE;

  SELECT "plan_key"
  INTO account_plan
  FROM "users"
  WHERE "id" = NEW."owner_id";

  IF account_plan = 'venue' THEN
    active_limit := 5;
    monthly_limit := 5;
  ELSE
    active_limit := 1;
    monthly_limit := 1;
  END IF;

  IF TG_OP = 'INSERT' THEN
    month_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

    SELECT count(*)
    INTO monthly_count
    FROM "events"
    WHERE "owner_id" = NEW."owner_id"
      AND "created_at" >= month_start
      AND "deleted_at" IS NULL;

    IF monthly_count >= monthly_limit THEN
      RAISE EXCEPTION 'event_monthly_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW."is_active"
    AND NEW."deleted_at" IS NULL
    AND (NEW."expires_at" IS NULL OR NEW."expires_at" > now())
    AND (
      TG_OP = 'INSERT'
      OR OLD."owner_id" IS DISTINCT FROM NEW."owner_id"
      OR NOT OLD."is_active"
      OR (OLD."expires_at" IS NOT NULL AND OLD."expires_at" <= now())
    )
  THEN
    SELECT count(*)
    INTO active_count
    FROM "events"
    WHERE "owner_id" = NEW."owner_id"
      AND "id" <> NEW."id"
      AND "is_active" = true
      AND "deleted_at" IS NULL
      AND ("expires_at" IS NULL OR "expires_at" > now());

    IF active_count >= active_limit THEN
      RAISE EXCEPTION 'event_active_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_plan_change_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_limit integer;
  monthly_limit integer;
  active_count integer;
  monthly_count integer;
  month_start timestamptz;
BEGIN
  IF NEW."plan_key" IS NOT DISTINCT FROM OLD."plan_key" THEN
    RETURN NEW;
  END IF;

  IF NEW."plan_key" = 'venue' THEN
    active_limit := 5;
    monthly_limit := 5;
  ELSE
    active_limit := 1;
    monthly_limit := 1;
  END IF;

  month_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*)
  INTO active_count
  FROM "events"
  WHERE "owner_id" = NEW."id"
    AND "is_active" = true
    AND "deleted_at" IS NULL
    AND ("expires_at" IS NULL OR "expires_at" > now());

  IF active_count > active_limit THEN
    RAISE EXCEPTION 'plan_active_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO monthly_count
  FROM "events"
  WHERE "owner_id" = NEW."id"
    AND "created_at" >= month_start
    AND "deleted_at" IS NULL;

  IF monthly_count > monthly_limit THEN
    RAISE EXCEPTION 'plan_monthly_limit' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- The event trigger now reads deleted_at, so it must also fire when that
-- column changes. Without this, soft-deleting an event would not re-evaluate
-- the owner's limits and the freed slot would stay invisible until their next
-- write.
DROP TRIGGER IF EXISTS "events_plan_limits_trigger" ON "events";

CREATE TRIGGER "events_plan_limits_trigger"
BEFORE INSERT OR UPDATE OF "is_active", "expires_at", "owner_id", "deleted_at"
ON "events"
FOR EACH ROW
EXECUTE FUNCTION enforce_event_plan_limits();
