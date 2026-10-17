-- ACC-8: a link to choose one's own password, emailed from /admin to a login
-- Klik made. See lib/password-links.ts. Re-runnable.
--
-- Only the hash of the link's code is kept. A link works once, for seven
-- days, and a newer one for the same account ends any older one, so the last
-- email sent is the only one that works.

CREATE TABLE IF NOT EXISTS "password_links" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "password_links_user_idx" ON "password_links" ("user_id");
