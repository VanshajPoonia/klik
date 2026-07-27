ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "plan_key" text DEFAULT 'event' NOT NULL;

UPDATE "users"
SET "plan_key" = 'venue'
WHERE "id" IN (
  SELECT "owner_id"
  FROM "events"
  GROUP BY "owner_id"
  HAVING COUNT(*) > 1
);

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "credential_version" integer DEFAULT 0 NOT NULL;
