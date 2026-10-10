-- GRW-5: referral credits. See ROADMAP.md GRW-5 and lib/referrals.ts. Re-runnable.

-- Every account's code, made by the database so no insert path can forget it.
-- Random rather than the username, so a renamed account's links keep working
-- and codes cannot be guessed from handles. A volatile default is evaluated
-- per row, so existing accounts each get their own code as the column lands.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text
  NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10);
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_idx" ON "users" ("referral_code");

-- Who brought whom. One referrer per account, for life, and never yourself.
-- Qualified when the referred account is first granted a plan, which is the
-- moment a human has matched it to a payment (BILLING.md).
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" text PRIMARY KEY,
  "referrer_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referred_id" text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "qualified_at" timestamp with time zone,
  CONSTRAINT "referrals_not_self" CHECK ("referrer_id" <> "referred_id")
);
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" ("referrer_id", "created_at" DESC);

-- Money an account is owed against a future purchase, as a ledger: a credit
-- is a positive row, using it is a negative one, and the balance is the sum.
-- Rows are never updated. Klik's payments are hosted Stripe links with a
-- human granting every plan, so credit is used by a superadmin, by hand, with
-- a reason, exactly like a grant.
CREATE TABLE IF NOT EXISTS "account_credits" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "reason" text NOT NULL,
  "referral_id" text REFERENCES "referrals"("id") ON DELETE SET NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_credits_amount_check" CHECK ("amount_cents" <> 0 AND abs("amount_cents") <= 100000),
  CONSTRAINT "account_credits_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS "account_credits_user_idx" ON "account_credits" ("user_id", "created_at" DESC);

-- A referral pays out once per side: two rows, one for each account.
CREATE UNIQUE INDEX IF NOT EXISTS "account_credits_referral_once_idx"
ON "account_credits" ("referral_id", "user_id") WHERE "referral_id" IS NOT NULL;
