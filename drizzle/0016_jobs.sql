-- F-5: a background job queue in Postgres. See lib/jobs.ts and lib/job-runner.ts.
--
-- Written to be re-runnable. scripts/test-db.sh applies it on top of a schema
-- that drizzle-kit push already created, because push cannot express the
-- partial indexes below, and the dedupe index is the one `enqueue` depends on.

BEGIN;

CREATE TABLE IF NOT EXISTS "jobs" (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "run_after" timestamptz NOT NULL DEFAULT now(),
  "locked_at" timestamptz,
  "locked_by" text,
  "last_error" text,
  "dedupe_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);

-- A check rather than an enum, matching event_co_hosts.role: adding a status
-- later should be a constraint swap, not a type migration under lock.
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_status_check";
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check"
  CHECK ("status" IN ('queued', 'running', 'succeeded', 'dead'));

-- What the claim query scans: due work, oldest first.
CREATE INDEX IF NOT EXISTS "jobs_due_idx"
  ON "jobs" ("run_after")
  WHERE "status" = 'queued';

-- What the stale-lock reclaim scans: work a killed function left marked running.
CREATE INDEX IF NOT EXISTS "jobs_running_idx"
  ON "jobs" ("locked_at")
  WHERE "status" = 'running';

-- One live job per dedupe key. Scoped to queued and running so a finished job
-- never blocks the next run of the same work.
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_dedupe_live_idx"
  ON "jobs" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" IN ('queued', 'running');

-- Retention sweep in the daily cron deletes finished rows by age.
CREATE INDEX IF NOT EXISTS "jobs_finished_idx"
  ON "jobs" ("finished_at")
  WHERE "finished_at" IS NOT NULL;

COMMIT;
