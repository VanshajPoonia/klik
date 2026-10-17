-- MSG-1: messages between an account and Klik. One conversation per account,
-- read by every superadmin on /admin/messages. See lib/messages.ts.
-- Re-runnable.
--
-- The thread row exists so "unread" is a comparison on one row rather than a
-- scan, and so a notification is sent once per unread stretch rather than per
-- message. Messages are never edited. Erasing the account erases its
-- conversation; a superadmin who leaves keeps their replies, unattributed.

CREATE TABLE IF NOT EXISTS "support_threads" (
  "account_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "last_message_at" timestamptz NOT NULL DEFAULT now(),
  "account_read_at" timestamptz,
  "klik_read_at" timestamptz,
  -- When each side was last emailed about this thread.
  "account_notified_at" timestamptz,
  "klik_notified_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "support_threads_recent_idx" ON "support_threads" ("last_message_at" DESC);

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL REFERENCES "support_threads"("account_id") ON DELETE CASCADE,
  "author_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "from_klik" boolean NOT NULL,
  "body" text NOT NULL,
  -- Which event it is about, when the writer said.
  "event_id" text REFERENCES "events"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS "support_messages_thread_idx" ON "support_messages" ("account_id", "created_at");
