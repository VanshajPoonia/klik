-- Self-serve signup, and the guard that stops it giving the product away.
--
-- `users.plan_key` is NOT NULL DEFAULT 'event', so the moment an account can be
-- created by whoever fills in a form, that account can create one event with a
-- 30-day upload window and a 6-month gallery. That is Klik Event, the $39
-- product, for free. Until now the only way to get a row in `users` was a
-- superadmin at /admin/new, which is why the default was harmless.
--
-- `activated_at` is the capability gate that `plan_key` cannot be: null means
-- the account exists, can sign in, and can see its dashboard, but cannot create
-- an event yet. A superadmin sets it when they grant the plan, which is the same
-- manual decision described in BILLING.md under "The grant is manual".
--
-- Deliberately NOT a change to `plan_key`. Two plpgsql triggers read that column
-- directly (drizzle/0002_plan_capabilities.sql, drizzle/0003_soft_delete_and_retention.sql)
-- and ROADMAP ACT-1 is the task that retires it. A nullable column alongside is
-- additive: ACT-1 can absorb or drop it without unpicking anything.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activated_at" timestamp with time zone;

-- Every account that exists right now was created by hand by a superadmin, who
-- had already decided to grant it. Backfilling is what stops this migration
-- locking out every current organizer and venue the moment it lands.
UPDATE "users" SET "activated_at" = now() WHERE "activated_at" IS NULL;

-- When the account came into being. The table has never had this, which was
-- survivable while every row was created by a superadmin who knew. It is not
-- survivable now: the first question asked about an account awaiting activation
-- is how long it has been waiting, and ordering a queue needs something to order
-- it by.
--
-- Existing rows get now(), which is wrong about the past and harmless: they are
-- all activated by the statement above, so none of them appear in that queue.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();

-- Finding a self-signup means finding the few rows where this is null, against a
-- table that is otherwise entirely non-null. A partial index keeps that lookup
-- on /admin cheap and costs nothing for the rows it excludes.
CREATE INDEX IF NOT EXISTS "users_awaiting_activation_idx"
  ON "users" ("role")
  WHERE "activated_at" IS NULL;

-- Both new email lookups are case-insensitive, and `users_email_unique` is a
-- plain index on the column, which a `lower(email) = $1` predicate cannot use.
-- The two callers are the duplicate check in app/api/signup/route.ts and the
-- credential sign-in in lib/auth.ts, so without this every login by email is a
-- sequential scan of the whole table.
--
-- Not UNIQUE on purpose. Making it unique would be a stricter rule than the one
-- already enforced, and it would fail to create on any existing pair of rows
-- differing only in case, which is exactly the kind of migration that gets
-- discovered in production.
CREATE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));
