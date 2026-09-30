-- Extend soft delete to the last two hard-delete paths. See ROADMAP.md SEC-4.
--
-- Both tables are referenced with ON DELETE SET NULL, which made a hard delete
-- quietly destructive in a way neither UI warned about:
--   * deleting an album unfiled every photo in it
--   * deleting a venue client detached every event that client ever had
-- Neither could be undone. Both now go to the same 30-day trash as media and
-- events, and the purge cron reaps them on the same schedule.
ALTER TABLE "albums"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "venue_clients"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "albums_deleted_idx" ON "albums" ("deleted_at");
CREATE INDEX IF NOT EXISTS "venue_clients_deleted_idx" ON "venue_clients" ("deleted_at");
