-- MED-7: ZIP exports built by the job queue into the bucket, so a large event
-- downloads from R2 at the organizer's own speed instead of streaming through
-- one function that times out at five minutes. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "exports" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "requested_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'building',
  "label" text NOT NULL,
  "part_count" integer NOT NULL,
  "parts_done" integer NOT NULL DEFAULT 0,
  "parts" jsonb NOT NULL,
  "total_bytes" bigint NOT NULL DEFAULT 0,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expires_at" timestamptz
);

ALTER TABLE "exports" DROP CONSTRAINT IF EXISTS "exports_status_check";
ALTER TABLE "exports" ADD CONSTRAINT "exports_status_check"
  CHECK ("status" IN ('building', 'ready', 'failed', 'expired'));

CREATE INDEX IF NOT EXISTS "exports_event_idx" ON "exports" ("event_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "exports_expiry_idx" ON "exports" ("expires_at")
  WHERE "status" = 'ready';

COMMIT;
