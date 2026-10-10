-- ACC-6: passkeys. See ROADMAP.md ACC-6 and lib/passkeys.ts. Re-runnable.

-- One row per passkey. The id is the credential id the authenticator chose,
-- base64url, which is what a sign-in names, so the lookup is the primary key.
-- Removing the account removes its passkeys; nothing else refers to them.
CREATE TABLE IF NOT EXISTS "user_passkeys" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- The COSE public key, base64url. Public by definition: it can check a
  -- signature and cannot make one.
  "public_key" text NOT NULL,
  -- The authenticator's signature counter. Synced passkeys always report 0; a
  -- hardware key counts up, and a count that goes backwards is a cloned key.
  "counter" bigint NOT NULL DEFAULT 0,
  "transports" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'multiDevice' for a passkey synced through iCloud or Google, 'singleDevice'
  -- for one that lives in a single phone or key.
  "device_type" text NOT NULL,
  "backed_up" boolean NOT NULL DEFAULT false,
  -- Which kind of authenticator made it, when it says, so the list can read
  -- "iCloud Keychain" rather than a string of hex.
  "aaguid" text,
  "name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  CONSTRAINT "user_passkeys_name_check" CHECK (char_length("name") BETWEEN 1 AND 60)
);

CREATE INDEX IF NOT EXISTS "user_passkeys_user_idx"
ON "user_passkeys" ("user_id", "created_at");
