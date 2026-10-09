-- The print studio. See ROADMAP.md QR-4a and QR-4c.

-- A design: one page at one size, as a scene the studio draws. `doc` carries
-- its own schema_version so an old design survives the editor changing.
-- `revision` counts saves, so a save made from a stale copy (a second tab, a
-- co-host) is refused rather than silently overwriting the newer one.
CREATE TABLE IF NOT EXISTS "print_designs" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "preset" text NOT NULL,
  "width_mm" real NOT NULL,
  "height_mm" real NOT NULL,
  "bleed_mm" real NOT NULL DEFAULT 3,
  "doc" jsonb NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  -- A small picture of the page for the list, under designs/<event>/.
  "thumbnail_key" text,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "print_designs_size_check" CHECK (
    "width_mm" BETWEEN 10 AND 2000 AND "height_mm" BETWEEN 10 AND 2000 AND "bleed_mm" BETWEEN 0 AND 20
  )
);

CREATE INDEX IF NOT EXISTS "print_designs_event_idx"
ON "print_designs" ("event_id", "updated_at" DESC);

-- Earlier states of a design, so a mis-click that autosave has already kept is
-- recoverable. The last ten are kept; older ones are deleted as new ones land.
CREATE TABLE IF NOT EXISTS "print_design_versions" (
  "id" text PRIMARY KEY,
  "design_id" text NOT NULL REFERENCES "print_designs"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "doc" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "print_design_versions_design_idx"
ON "print_design_versions" ("design_id", "created_at" DESC);

-- Photos and logos the host uploads for designs, under designs/<event>/, a
-- prefix the orphan reaper and the backup never walk. The pixel size is kept
-- so the studio can warn about a photo too small to print sharply.
CREATE TABLE IF NOT EXISTS "print_assets" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "key" text NOT NULL UNIQUE,
  "mime_type" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "print_assets_event_idx"
ON "print_assets" ("event_id", "created_at" DESC);
