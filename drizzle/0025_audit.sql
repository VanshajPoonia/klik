-- ADM-4: who did what, for the actions that change access, money or data.
-- Append-only, like account_timeline; a correction is another row. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" text PRIMARY KEY,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  -- Denormalised, so the record still names somebody after their account goes.
  "actor_label" text,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_log_event_idx" ON "audit_log" ("event_id", "created_at" DESC)
  WHERE "event_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" ("actor_user_id", "created_at" DESC);

COMMIT;
