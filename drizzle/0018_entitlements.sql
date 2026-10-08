-- ACT-1: the entitlement ledger. See lib/entitlements.ts and lib/schema.ts.
--
-- Re-runnable like every migration here (scripts/test-db.sh lays them over a
-- pushed schema). The backfill runs only while the ledger is empty, so a second
-- run cannot grant anyone anything twice.

BEGIN;

CREATE TABLE IF NOT EXISTS "entitlements" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_key" text NOT NULL,
  "scope" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "applied_event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "applied_at" timestamptz,
  "starts_at" timestamptz NOT NULL DEFAULT now(),
  "ends_at" timestamptz,
  "max_active_events" integer,
  "max_events_per_month" integer,
  "reason" text,
  "granted_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "granted_by_label" text,
  "stripe_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "revoked_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "revoke_reason" text
);

ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_plan_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_plan_check"
  CHECK ("plan_key" IN ('event', 'premium', 'venue'));
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_scope_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_scope_check"
  CHECK ("scope" IN ('event', 'account'));
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_source_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_source_check"
  CHECK ("source" IN ('admin', 'stripe', 'promo'));
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_status_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_status_check"
  CHECK ("status" IN ('active', 'revoked'));
-- A pass is spent on one event; only an account grant carries limits.
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_shape_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_shape_check"
  CHECK (
    ("scope" = 'event' AND "max_active_events" IS NULL AND "max_events_per_month" IS NULL)
    OR ("scope" = 'account' AND "applied_at" IS NULL AND "applied_event_id" IS NULL)
  );
-- Revocation is recorded, never implied.
ALTER TABLE "entitlements" DROP CONSTRAINT IF EXISTS "entitlements_revoked_check";
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_revoked_check"
  CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "entitlements_user_idx" ON "entitlements" ("user_id", "created_at");
-- "Does this account have a pass to spend", the question event creation asks.
CREATE INDEX IF NOT EXISTS "entitlements_unused_pass_idx"
  ON "entitlements" ("user_id", "created_at")
  WHERE "scope" = 'event' AND "status" = 'active' AND "applied_at" IS NULL;

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "entitlement_id" text;
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_entitlement_fk";
ALTER TABLE "events" ADD CONSTRAINT "events_entitlement_fk"
  FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE SET NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "plan_key" text;
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_plan_check";
ALTER TABLE "events" ADD CONSTRAINT "events_plan_check"
  CHECK ("plan_key" IS NULL OR "plan_key" IN ('event', 'premium', 'venue'));
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "licensed_at" timestamptz;
-- ACT-4: an organizer asked for this draft to be activated. The admin queue is
-- drafts with this set, soonest event first.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "activation_requested_at" timestamptz;
CREATE INDEX IF NOT EXISTS "events_activation_requested_idx" ON "events" ("activation_requested_at")
  WHERE "activation_requested_at" IS NOT NULL AND "licensed_at" IS NULL AND "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "events_entitlement_idx" ON "events" ("entitlement_id")
  WHERE "entitlement_id" IS NOT NULL;

-- The backfill: everyone keeps exactly what they have today.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "entitlements") THEN
    -- Venue accounts: one account grant licensing every event they own.
    INSERT INTO "entitlements"
      ("id", "user_id", "plan_key", "scope", "source", "max_active_events",
       "max_events_per_month", "reason", "starts_at")
    SELECT 'ent_acct_' || u."id", u."id", 'venue', 'account', 'admin', 5, 5,
           'Carried over from the account plan when the ledger was introduced, 2026-10-08',
           COALESCE(u."activated_at", u."created_at")
    FROM "users" u
    WHERE u."activated_at" IS NOT NULL AND u."plan_key" = 'venue';

    UPDATE "events" e
    SET "entitlement_id" = 'ent_acct_' || e."owner_id", "plan_key" = 'venue',
        "licensed_at" = e."created_at"
    FROM "users" u
    WHERE u."id" = e."owner_id" AND u."activated_at" IS NOT NULL AND u."plan_key" = 'venue';

    -- Event and Premium accounts: a spent pass for each event they already have,
    -- soft-deleted ones included so a restore brings back a working gallery.
    INSERT INTO "entitlements"
      ("id", "user_id", "plan_key", "scope", "source", "applied_event_id",
       "applied_at", "reason", "starts_at")
    SELECT 'ent_evt_' || e."id", e."owner_id", u."plan_key", 'event', 'admin', e."id",
           e."created_at",
           'Carried over from the account plan when the ledger was introduced, 2026-10-08',
           e."created_at"
    FROM "events" e
    JOIN "users" u ON u."id" = e."owner_id"
    WHERE u."activated_at" IS NOT NULL AND u."plan_key" IN ('event', 'premium');

    UPDATE "events" e
    SET "entitlement_id" = 'ent_evt_' || e."id", "plan_key" = u."plan_key",
        "licensed_at" = e."created_at"
    FROM "users" u
    WHERE u."id" = e."owner_id" AND u."activated_at" IS NOT NULL
      AND u."plan_key" IN ('event', 'premium');

    -- And an unspent pass for an activated account that never created its event:
    -- somebody granted it a plan, and it has not used it yet.
    INSERT INTO "entitlements"
      ("id", "user_id", "plan_key", "scope", "source", "reason", "starts_at")
    SELECT 'ent_pass_' || u."id", u."id", u."plan_key", 'event', 'admin',
           'Carried over from the account plan when the ledger was introduced, 2026-10-08',
           u."activated_at"
    FROM "users" u
    WHERE u."activated_at" IS NOT NULL AND u."plan_key" IN ('event', 'premium')
      AND NOT EXISTS (SELECT 1 FROM "events" e WHERE e."owner_id" = u."id");
  END IF;
END $$;

-- The plan-limit triggers from 0002 and 0003 read users.plan_key, which this
-- retires, and hard-coded "venue is 5, everything else is 1" in plpgsql: a
-- second copy of lib/plans.ts that agreed with it only by coincidence.
DROP TRIGGER IF EXISTS "events_plan_limits_trigger" ON "events";
DROP TRIGGER IF EXISTS "users_plan_limits_trigger" ON "users";
DROP FUNCTION IF EXISTS enforce_event_plan_limits();
DROP FUNCTION IF EXISTS enforce_plan_change_limits();

-- Their replacement reads its numbers from the grant, so lib/plans.ts stays the
-- only place a limit is written down. The grant row is locked first, which
-- serializes every licence decision for one grant: two events racing for the
-- last Venue slot, or for the same pass, cannot both win, transactions or not.
CREATE OR REPLACE FUNCTION enforce_entitlement_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row record;
  becoming_licensed boolean;
  becoming_active boolean;
  live_count integer;
  month_count integer;
  month_start timestamptz;
BEGIN
  IF NEW."entitlement_id" IS NULL THEN
    RETURN NEW;
  END IF;

  becoming_licensed := TG_OP = 'INSERT' OR OLD."entitlement_id" IS DISTINCT FROM NEW."entitlement_id";
  becoming_active := NEW."is_active" AND NEW."deleted_at" IS NULL
    AND (NEW."expires_at" IS NULL OR NEW."expires_at" > now())
    AND (
      becoming_licensed
      OR NOT OLD."is_active"
      OR OLD."deleted_at" IS NOT NULL
      OR (OLD."expires_at" IS NOT NULL AND OLD."expires_at" <= now())
    );

  -- Nothing about this write can break a limit: a soft delete, a deactivation,
  -- a rename. Returning early is also what lets an event under a revoked grant
  -- still be deleted.
  IF NOT becoming_licensed AND NOT becoming_active THEN
    RETURN NEW;
  END IF;

  SELECT "user_id", "scope", "status", "ends_at", "max_active_events", "max_events_per_month"
  INTO grant_row
  FROM "entitlements"
  WHERE "id" = NEW."entitlement_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entitlement_missing' USING ERRCODE = 'P0001';
  END IF;
  IF becoming_licensed THEN
    IF grant_row."user_id" <> NEW."owner_id" THEN
      RAISE EXCEPTION 'entitlement_owner_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF grant_row."status" <> 'active' OR (grant_row."ends_at" IS NOT NULL AND grant_row."ends_at" <= now()) THEN
      RAISE EXCEPTION 'entitlement_inactive' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF grant_row."scope" = 'event' THEN
    -- One pass, one event, ever.
    IF becoming_licensed AND EXISTS (
      SELECT 1 FROM "events"
      WHERE "entitlement_id" = NEW."entitlement_id" AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'entitlement_already_applied' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF becoming_active AND grant_row."max_active_events" IS NOT NULL THEN
    SELECT count(*) INTO live_count
    FROM "events"
    WHERE "entitlement_id" = NEW."entitlement_id"
      AND "id" <> NEW."id"
      AND "is_active" AND "deleted_at" IS NULL
      AND ("expires_at" IS NULL OR "expires_at" > now());
    IF live_count >= grant_row."max_active_events" THEN
      RAISE EXCEPTION 'entitlement_active_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF becoming_licensed AND grant_row."max_events_per_month" IS NOT NULL THEN
    month_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT count(*) INTO month_count
    FROM "events"
    WHERE "entitlement_id" = NEW."entitlement_id"
      AND "id" <> NEW."id"
      AND "deleted_at" IS NULL
      AND "licensed_at" >= month_start;
    IF month_count >= grant_row."max_events_per_month" THEN
      RAISE EXCEPTION 'entitlement_monthly_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "events_entitlement_limits" ON "events";
CREATE TRIGGER "events_entitlement_limits"
BEFORE INSERT OR UPDATE OF "entitlement_id", "is_active", "expires_at", "owner_id", "deleted_at"
ON "events"
FOR EACH ROW
EXECUTE FUNCTION enforce_entitlement_limits();

COMMIT;
