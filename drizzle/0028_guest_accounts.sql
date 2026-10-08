-- ACC-1: one identity, three capacities. A signed-in person is a guest at the
-- events they joined and an organizer at the events they own; there is no
-- second account system. A guest row with no user_id is an anonymous guest,
-- exactly as before. Re-runnable.

BEGIN;

ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "user_id" text
  REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "guests_user_idx" ON "guests" ("user_id", "created_at" DESC)
  WHERE "user_id" IS NOT NULL;

-- ACC-2: a code sign-in creates an account for anyone who types an email,
-- most of them guests keeping a gallery. The superadmin's "Signed up, not
-- activated" queue listed every account without a plan, so each of those
-- would have read as a customer waiting to be activated. This marks the ones
-- that came to run events: through /signup, or by opening a plan's payment
-- link while signed in.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organizer_intent_at" timestamptz;
-- Every account that exists today came through /signup or /admin.
UPDATE "users" SET "organizer_intent_at" = "created_at" WHERE "organizer_intent_at" IS NULL;

COMMIT;
