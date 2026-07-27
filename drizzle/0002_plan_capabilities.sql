ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "venue_slug" text;

CREATE UNIQUE INDEX IF NOT EXISTS "users_venue_slug_unique"
ON "users" ("venue_slug");

UPDATE "users"
SET "venue_slug" = 'venue-' || substr(md5("id"), 1, 12)
WHERE "plan_key" = 'venue' AND "venue_slug" IS NULL;

CREATE TABLE IF NOT EXISTS "venue_clients" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "venue_clients_owner_idx"
ON "venue_clients" ("owner_id");

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "client_id" text REFERENCES "venue_clients" ("id") ON DELETE SET NULL;

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "access_version" integer NOT NULL DEFAULT 0;

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "accent_color" text NOT NULL DEFAULT '#e8f000';

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "background_color" text NOT NULL DEFAULT '#090a08';

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "qr_template" text NOT NULL DEFAULT 'classic';

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "venue_featured" boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "events_owner_featured_unique"
ON "events" ("owner_id")
WHERE "venue_featured" = true;

UPDATE "events"
SET "is_active" = false
WHERE "expires_at" IS NOT NULL AND "expires_at" <= now();

CREATE TABLE IF NOT EXISTS "event_co_hosts" (
  "event_id" text NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("event_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "event_co_hosts_user_idx"
ON "event_co_hosts" ("user_id");

CREATE TABLE IF NOT EXISTS "albums" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "albums_event_idx"
ON "albums" ("event_id");

ALTER TABLE "media"
ADD COLUMN IF NOT EXISTS "album_id" text REFERENCES "albums" ("id") ON DELETE SET NULL;

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
      AND "created_at" >= month_start;

    IF monthly_count >= monthly_limit THEN
      RAISE EXCEPTION 'event_monthly_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW."is_active"
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
      AND ("expires_at" IS NULL OR "expires_at" > now());

    IF active_count >= active_limit THEN
      RAISE EXCEPTION 'event_active_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "events_plan_limits_trigger" ON "events";

CREATE TRIGGER "events_plan_limits_trigger"
BEFORE INSERT OR UPDATE OF "is_active", "expires_at", "owner_id"
ON "events"
FOR EACH ROW
EXECUTE FUNCTION enforce_event_plan_limits();

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
    AND ("expires_at" IS NULL OR "expires_at" > now());

  IF active_count > active_limit THEN
    RAISE EXCEPTION 'plan_active_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO monthly_count
  FROM "events"
  WHERE "owner_id" = NEW."id"
    AND "created_at" >= month_start;

  IF monthly_count > monthly_limit THEN
    RAISE EXCEPTION 'plan_monthly_limit' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "users_plan_limits_trigger" ON "users";

CREATE TRIGGER "users_plan_limits_trigger"
BEFORE UPDATE OF "plan_key"
ON "users"
FOR EACH ROW
EXECUTE FUNCTION enforce_plan_change_limits();
