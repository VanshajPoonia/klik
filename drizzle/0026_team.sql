-- ORG-3 and ORG-4: inviting someone without an account, and handing an event
-- to someone else. Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "event_invites" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'manager',
  -- Only a hash is stored. The link in the email carries the token itself,
  -- so a database leak does not hand out working invitations.
  "token_hash" text NOT NULL UNIQUE,
  "invited_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "accepted_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamptz
);
ALTER TABLE "event_invites" DROP CONSTRAINT IF EXISTS "event_invites_role_check";
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_role_check"
  CHECK ("role" IN ('manager', 'moderator', 'contributor'));
CREATE INDEX IF NOT EXISTS "event_invites_event_idx" ON "event_invites" ("event_id", "created_at" DESC);
-- One open invitation per address per event.
CREATE UNIQUE INDEX IF NOT EXISTS "event_invites_open_idx" ON "event_invites" ("event_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- ORG-4: an offer to hand the event to a member of its team, pending their yes.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "transfer_to_user_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "transfer_offered_at" timestamptz;

COMMIT;
