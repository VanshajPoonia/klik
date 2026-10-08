-- QR-1: many addresses, one gallery, and no address ever reused. Re-runnable.
--
-- events.slug stays the primary address. event_slugs holds every address the
-- event used to have, and they keep working. When an event is deleted, all of
-- its addresses become hashed reservations, so a printed QR code from any
-- point in its life can never lead to a stranger's gallery. Hashed, because
-- "anna-and-leo" is a little personal to keep in plain text after an erasure.

BEGIN;

CREATE TABLE IF NOT EXISTS "event_slugs" (
  "slug" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "event_slugs_event_idx" ON "event_slugs" ("event_id");

CREATE TABLE IF NOT EXISTS "slug_reservations" (
  "slug_hash" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION klik_slug_hash(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(lower(value), 'UTF8')), 'hex');
$$;

-- Is this address in use by any event other than `owner`, or reserved?
CREATE OR REPLACE FUNCTION klik_slug_taken(value text, owner text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "events" WHERE lower("slug") = lower(value) AND "id" <> owner)
      OR EXISTS (SELECT 1 FROM "event_slugs" WHERE lower("slug") = lower(value) AND "event_id" <> owner)
      OR EXISTS (SELECT 1 FROM "slug_reservations" WHERE "slug_hash" = klik_slug_hash(value));
$$;

CREATE OR REPLACE FUNCTION enforce_event_slug_unique()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF klik_slug_taken(NEW."slug", NEW."id") THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "events_slug_unique" ON "events";
CREATE TRIGGER "events_slug_unique" BEFORE INSERT OR UPDATE OF "slug" ON "events"
FOR EACH ROW EXECUTE FUNCTION enforce_event_slug_unique();

CREATE OR REPLACE FUNCTION enforce_alias_slug_unique()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF klik_slug_taken(NEW."slug", NEW."event_id") THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "event_slugs_unique" ON "event_slugs";
CREATE TRIGGER "event_slugs_unique" BEFORE INSERT ON "event_slugs"
FOR EACH ROW EXECUTE FUNCTION enforce_alias_slug_unique();

-- Before the delete, while the event's aliases still exist to be read.
CREATE OR REPLACE FUNCTION reserve_slugs_on_event_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "slug_reservations" ("slug_hash")
  SELECT klik_slug_hash(s) FROM (
    SELECT OLD."slug" AS s
    UNION
    SELECT "slug" FROM "event_slugs" WHERE "event_id" = OLD."id"
  ) addresses
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS "events_reserve_slugs" ON "events";
CREATE TRIGGER "events_reserve_slugs" BEFORE DELETE ON "events"
FOR EACH ROW EXECUTE FUNCTION reserve_slugs_on_event_delete();

COMMIT;
