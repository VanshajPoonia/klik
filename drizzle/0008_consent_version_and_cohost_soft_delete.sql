-- Consent versioning and the last remaining hard delete. See ROADMAP.md.

-- 1. Which consent text a guest actually agreed to.
--    consented_at recorded WHEN someone ticked a box, never WHAT the box said,
--    so it could not answer the one question that matters if they object. The
--    copy could also change underneath everyone who had already agreed.
ALTER TABLE "guests"
ADD COLUMN IF NOT EXISTS "consent_version" text;

-- Existing guests agreed to the text that was hard-coded in entry-sheet.tsx,
-- which is byte-for-byte the statement now published as version 2026-09-30.
-- Backfilling is accurate rather than convenient: it records what they saw.
UPDATE "guests" SET "consent_version" = '2026-09-30' WHERE "consent_version" IS NULL;

-- 2. Co-host removal becomes reversible like every other delete.
--    This row grants ACCESS, so unlike other soft-deleted records a missed
--    filter leaves a removed co-host still able to manage the gallery rather
--    than merely showing stale data. Exactly one query reads this table for
--    authorization (requireEventManagerSession in lib/roles.ts) and the
--    revocation predicate lives there.
ALTER TABLE "event_co_hosts"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "event_co_hosts_live_idx"
ON "event_co_hosts" ("event_id")
WHERE "deleted_at" IS NULL;
