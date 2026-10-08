-- ID-1: usernames that are unique without regard to case, and that can change
-- without the old one being snapped up the same minute. Re-runnable.

BEGIN;

-- `Anita` and `anita` were both claimable, because the unique constraint was
-- on the column as typed. Checked against production before writing this:
-- no two accounts collide once lowercased.
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_idx" ON "users" (lower("username"))
  WHERE "username" IS NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username_changed_at" timestamptz;

-- A handle given up by a change, held for 30 days so a co-host who knew
-- someone as @anita does not find a stranger there the next morning. The
-- reserved words live in lib/username.ts, where they are tested.
CREATE TABLE IF NOT EXISTS "username_reservations" (
  "username_lower" text PRIMARY KEY,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "released_at" timestamptz NOT NULL
);

-- Taking a handle somebody else has parked is refused here, so no path that
-- writes a username (the account page, the admin console, a script) can skip
-- it. The person who parked it may take it back.
CREATE OR REPLACE FUNCTION guard_username() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."username" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND lower(NEW."username") IS NOT DISTINCT FROM lower(OLD."username") THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "username_reservations" r
    WHERE r."username_lower" = lower(NEW."username")
      AND r."released_at" > now()
      AND r."user_id" IS DISTINCT FROM NEW."id"
  ) THEN
    RAISE EXCEPTION 'username_reserved' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "users_username_guard" ON "users";
CREATE TRIGGER "users_username_guard"
BEFORE INSERT OR UPDATE OF "username" ON "users"
FOR EACH ROW EXECUTE FUNCTION guard_username();

-- And the old handle is parked by the same change that gives it up.
CREATE OR REPLACE FUNCTION park_old_username() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."username" IS NULL OR lower(OLD."username") IS NOT DISTINCT FROM lower(NEW."username") THEN
    RETURN NEW;
  END IF;
  INSERT INTO "username_reservations" ("username_lower", "user_id", "reason", "released_at")
  VALUES (lower(OLD."username"), NEW."id", 'changed', now() + interval '30 days')
  ON CONFLICT ("username_lower") DO UPDATE
    SET "user_id" = EXCLUDED."user_id", "reason" = EXCLUDED."reason",
        "created_at" = now(), "released_at" = EXCLUDED."released_at";
  -- Taking back a handle you parked yourself ends its parking.
  IF NEW."username" IS NOT NULL THEN
    DELETE FROM "username_reservations"
    WHERE "username_lower" = lower(NEW."username") AND "user_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "users_username_park" ON "users";
CREATE TRIGGER "users_username_park"
AFTER UPDATE OF "username" ON "users"
FOR EACH ROW EXECUTE FUNCTION park_old_username();

COMMIT;
