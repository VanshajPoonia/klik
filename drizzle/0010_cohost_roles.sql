-- Co-host roles. See ROADMAP.md ORG-1 and ORG-2.

-- Until now a co-host was a boolean: present in this table or not. Anyone added
-- so they could upload could also rotate the QR code, change the gallery
-- password and remove the other co-hosts. The role column is what makes "add
-- the photographer" a safe thing to do.
--
-- Default 'manager', which is exactly what every existing row already had in
-- practice, so the backfill records reality rather than changing it.
ALTER TABLE "event_co_hosts"
ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'manager';

-- The matrix lives in lib/permissions.ts; this constraint only stops a value
-- that has no meaning at all from being written. Deliberately not an enum type:
-- adding a role to a Postgres enum needs a migration and a lock, and the set is
-- expected to grow.
ALTER TABLE "event_co_hosts"
DROP CONSTRAINT IF EXISTS "event_co_hosts_role_check";

ALTER TABLE "event_co_hosts"
ADD CONSTRAINT "event_co_hosts_role_check"
CHECK ("role" IN ('manager', 'moderator', 'contributor'));
