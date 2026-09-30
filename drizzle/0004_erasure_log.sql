-- Hard deletion (GDPR-style erasure), as distinct from the 30-day soft delete
-- added in 0003. See ROADMAP.md TRS-2.

-- Proof that an erasure happened, without keeping the thing that was erased.
-- subject_hash is a SHA-256 of the subject's id: the log has to outlive the
-- deletion to be useful, and storing the raw identifier would recreate in the
-- audit trail exactly the record the request was meant to remove.
CREATE TABLE IF NOT EXISTS "erasure_log" (
  "id" text PRIMARY KEY,
  "subject_type" text NOT NULL,
  "subject_hash" text NOT NULL,
  "media_deleted" integer NOT NULL DEFAULT 0,
  "bytes_deleted" bigint NOT NULL DEFAULT 0,
  "requested_by" text,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "erasure_log_created_idx"
ON "erasure_log" ("created_at" DESC);

-- Guest rows outlived the media they described. A purge keeps the event row so
-- the dashboard can explain what happened, but it deleted the media and left
-- every guest's display name and consent timestamp behind indefinitely. Those
-- existed only to attribute photos that no longer exist.
DELETE FROM "guests" g
USING "events" e
WHERE g."event_id" = e."id"
  AND e."purged_at" IS NOT NULL;
