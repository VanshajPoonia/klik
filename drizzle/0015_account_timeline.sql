-- An append-only record of what has happened to an account.
--
-- The problem this solves. Every fact about where a customer has got to is
-- currently either derived from present state or thrown away. `activated_at`
-- says they were activated but not by whom or on which plan first. The welcome
-- and access emails report their outcome to whoever is looking at the screen
-- and then the outcome is gone, so a send that was refused at 2am is
-- indistinguishable from one that was never attempted. "I paid and never heard
-- anything" is answerable for the last send only, and only because 0014 added a
-- column for it.
--
-- Derived state answers "where are they now". This answers "what happened", and
-- the two come apart exactly when somebody is asking a question worth money: a
-- plan corrected twice, an email that bounced before it succeeded, an activation
-- somebody does not remember making.
--
-- Rows are written and never updated or deleted. Anything that needs a current
-- value reads the state columns; this table is the history behind them.
CREATE TABLE IF NOT EXISTS "account_timeline" (
  "id" text PRIMARY KEY,

  -- CASCADE, despite this being a log, because lib/erasure.ts hard-deletes the
  -- users row and an erasure that leaves the person's email address sitting in
  -- an audit trail is not an erasure. The log is evidence about an account, so
  -- it does not outlive the account.
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- No CHECK constraint, deliberately, and for the opposite reason to most
  -- columns here. A rejected insert loses the record, and the whole point of
  -- this table is that records are not lost. An unrecognised kind rendering as
  -- itself on /admin is a cosmetic problem; a kind added in code and refused by
  -- the database is a silent hole in the history. See TIMELINE_KINDS in
  -- lib/schema.ts for the vocabulary the application writes.
  "kind" text NOT NULL,

  -- One human-readable sentence, already assembled. Not jsonb: nothing queries
  -- inside it, this table has no precedent for jsonb to follow, and the only
  -- consumer is a list on /admin that a person reads.
  "detail" text,

  -- Who did it. Null for anything the system did to itself, such as a signup.
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,

  -- The actor's name as it was at the time, denormalised on purpose. The FK
  -- above goes null when a superadmin account is removed, and a history that
  -- says "somebody granted this plan" is worth much less than one that says who.
  -- Renaming an admin must also not silently rewrite the past.
  "actor_label" text,

  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Every read is "this account's history, newest first". There is no query that
-- wants the whole table.
CREATE INDEX IF NOT EXISTS "account_timeline_user_idx"
  ON "account_timeline" ("user_id", "created_at" DESC);

-- Finding every account stuck at the same step, which is the question asked when
-- something is broken rather than when one customer calls.
CREATE INDEX IF NOT EXISTS "account_timeline_kind_idx"
  ON "account_timeline" ("kind", "created_at" DESC);
