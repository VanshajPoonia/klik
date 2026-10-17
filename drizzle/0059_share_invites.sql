-- MED-14: share links for particular people. See lib/share-invites.ts.
-- Re-runnable.
--
-- A link with invite_only set opens for the event's team and for the accounts
-- it was sent to, nobody else, whoever holds the URL. The gate is in
-- lib/share-request.ts, the one place every share surface resolves a token.
--
-- An invite is an address and the hash of a code that only its email carries.
-- The first account to open the link with that code, signed in with that
-- address, is written into user_id, and after that the account alone opens
-- it. Without the code, an account whose address was verified by a sign-in
-- code is let in too, which is how an invite that could not be emailed still
-- works. Removing an invite deletes its row: there is nothing to keep about a
-- person who was never meant to see the photos after all.

ALTER TABLE "media_shares" ADD COLUMN IF NOT EXISTS "invite_only" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "share_invites" (
  "id" text PRIMARY KEY,
  "share_id" text NOT NULL REFERENCES "media_shares"("id") ON DELETE CASCADE,
  "email" text NOT NULL CHECK ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254),
  "token_hash" text NOT NULL UNIQUE,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "invited_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "invited_by_guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "emailed_at" timestamptz,
  "opened_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "share_invites_share_email_idx" ON "share_invites" ("share_id", "email");
CREATE INDEX IF NOT EXISTS "share_invites_user_idx" ON "share_invites" ("user_id");
