ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "client_name" text;

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "client_email" text;

ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "client_phone" text;
