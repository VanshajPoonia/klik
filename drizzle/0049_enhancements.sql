-- AI-5's cloud tier: one row per "sharpen and enlarge" a host asks for. See
-- lib/enhancements.ts. Re-runnable.
--
-- The result is a new media row (derived_from_id = the source), never the
-- source changed. A row that did not fail counts against the event's
-- allowance, so a host cannot spend past it by asking twice at once.

CREATE TABLE IF NOT EXISTS "ai_enhancements" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "media_id" text NOT NULL REFERENCES "media"("id") ON DELETE CASCADE,
  "result_media_id" text REFERENCES "media"("id") ON DELETE SET NULL,
  "operation" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  -- Replicate's id, for the webhook to find this row by.
  "prediction_id" text,
  "error" text,
  "requested_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  -- What the host did with the result: shown instead of the source, shown
  -- beside it, or thrown away. Null while it waits for them.
  "choice" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_enhancements_operation_check') THEN
    ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_operation_check" CHECK ("operation" IN ('upscale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_enhancements_status_check') THEN
    ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_status_check"
      CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_enhancements_choice_check') THEN
    ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_choice_check"
      CHECK ("choice" IS NULL OR "choice" IN ('instead', 'both', 'discarded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_enhancements_error_check') THEN
    ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_error_check"
      CHECK ("error" IS NULL OR char_length("error") <= 500);
  END IF;
END $$;

-- One at a time per photo and operation: a double tap is one run.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_enhancements_active_idx"
ON "ai_enhancements" ("media_id", "operation")
WHERE "status" IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS "ai_enhancements_event_idx" ON "ai_enhancements" ("event_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_enhancements_prediction_idx" ON "ai_enhancements" ("prediction_id")
WHERE "prediction_id" IS NOT NULL;
