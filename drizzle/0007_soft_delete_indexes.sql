-- Index the queries soft delete actually created. See ROADMAP.md scalability notes.
--
-- Partial indexes are the right shape here. The gallery only ever reads live
-- rows, so an index that excludes trashed ones stays smaller, and the
-- "deleted_at IS NULL" predicate becomes free rather than a filter applied
-- after the index scan. The reverse applies to the purge cron, which only ever
-- reads trashed rows.

-- The hot path: one event's approved media, newest first, keyset paginated.
-- Ordered DESC to match the query, with id as the tiebreaker the cursor uses,
-- so the ORDER BY is satisfied by the index instead of a sort.
CREATE INDEX IF NOT EXISTS "media_gallery_idx"
ON "media" ("event_id", "status", "created_at" DESC, "id" DESC)
WHERE "deleted_at" IS NULL;

-- The purge cron's sweep. Tiny, because almost nothing is in the trash at once.
DROP INDEX IF EXISTS "media_deleted_idx";
CREATE INDEX IF NOT EXISTS "media_trash_idx"
ON "media" ("deleted_at")
WHERE "deleted_at" IS NOT NULL;

DROP INDEX IF EXISTS "albums_deleted_idx";
CREATE INDEX IF NOT EXISTS "albums_trash_idx"
ON "albums" ("deleted_at")
WHERE "deleted_at" IS NOT NULL;

DROP INDEX IF EXISTS "venue_clients_deleted_idx";
CREATE INDEX IF NOT EXISTS "venue_clients_trash_idx"
ON "venue_clients" ("deleted_at")
WHERE "deleted_at" IS NOT NULL;

-- Dashboards and plan-limit counts list an owner's live events.
CREATE INDEX IF NOT EXISTS "events_owner_live_idx"
ON "events" ("owner_id")
WHERE "deleted_at" IS NULL;

-- The purge cron's retention sweep: live, unpurged, past deadline.
CREATE INDEX IF NOT EXISTS "events_retention_idx"
ON "events" ("retention_until")
WHERE "deleted_at" IS NULL AND "purged_at" IS NULL;

-- Albums are listed per event, live only.
CREATE INDEX IF NOT EXISTS "albums_event_live_idx"
ON "albums" ("event_id")
WHERE "deleted_at" IS NULL;
