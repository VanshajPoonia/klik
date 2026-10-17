-- ACC-7: share links an account has opened, so /me can list what was shared
-- with it. See lib/share-saves.ts. Re-runnable.
--
-- Written only for a signed-in account that got through the share's own gate,
-- and read back through that gate's columns (revoked, expired), so a link
-- turned off by its owner disappears from /me with it. Holds no copy of
-- anything: the token is the link the person was already sent.

CREATE TABLE IF NOT EXISTS "share_saves" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "share_id" text NOT NULL REFERENCES "media_shares"("id") ON DELETE CASCADE,
  "first_opened_at" timestamptz NOT NULL DEFAULT now(),
  "last_opened_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "share_id")
);

CREATE INDEX IF NOT EXISTS "share_saves_share_idx" ON "share_saves" ("share_id");
