-- ADM-6: every time an account asked for a plan, so /admin can say who asked
-- for what. See lib/plan-requests.ts. Re-runnable.
--
-- A row is a click on a plan's button that reached /signup: the signup form,
-- or an account that was already signed in being sent on to pay. It grants
-- nothing (BILLING.md: a person grants, on /admin) and is never updated.
-- The occasion and date are what the buyer chose to tell us, both optional.
-- Erasing the account erases these with it.

CREATE TABLE IF NOT EXISTS "plan_requests" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_key" text NOT NULL,
  "occasion" text,
  "event_date" date,
  -- 'signup' (the form) or 'signed_in' (an existing account clicking a plan).
  "source" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "plan_requests_user_idx" ON "plan_requests" ("user_id", "created_at" DESC);
