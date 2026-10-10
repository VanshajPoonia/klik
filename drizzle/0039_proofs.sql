-- MED-10: watermarked proofs. See ROADMAP.md MED-10 and ARCHITECTURE.md
-- section 12. Re-runnable.

-- A photographer's watermark. Belongs to the person, not the event, because a
-- photographer's mark is their brand and follows them from job to job. The
-- stamp is a transparent PNG drawn in the browser (text and logo), so the
-- server only ever lays an image over an image and never depends on fonts.
CREATE TABLE IF NOT EXISTS "watermarks" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "stamp_key" text NOT NULL UNIQUE,
  "stamp_width" integer NOT NULL,
  "stamp_height" integer NOT NULL,
  -- The logo the stamp was drawn with, kept so the stamp can be drawn again
  -- with new words without asking for the logo a second time.
  "logo_key" text,
  "label" text NOT NULL,
  -- The typeface the label was drawn in, so it can be drawn again the same.
  "font" text NOT NULL DEFAULT 'sans',
  "position" text NOT NULL DEFAULT 'bottom-right',
  "opacity" real NOT NULL DEFAULT 0.5,
  "scale" real NOT NULL DEFAULT 0.3,
  -- Shown to whoever views a proof: how to get the clean photo. Klik takes no
  -- money for it; the photographer is paid however they already are.
  "buy_note" text,
  "buy_url" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "watermarks_font_check" CHECK ("font" IN ('sans', 'serif')),
  CONSTRAINT "watermarks_position_check" CHECK ("position" IN ('center', 'bottom-right', 'bottom-left', 'tiled')),
  CONSTRAINT "watermarks_opacity_check" CHECK ("opacity" BETWEEN 0.1 AND 0.9),
  CONSTRAINT "watermarks_scale_check" CHECK ("scale" BETWEEN 0.1 AND 0.6),
  CONSTRAINT "watermarks_label_check" CHECK (char_length("label") BETWEEN 1 AND 80),
  CONSTRAINT "watermarks_buy_note_check" CHECK ("buy_note" IS NULL OR char_length("buy_note") <= 240),
  CONSTRAINT "watermarks_buy_url_check" CHECK ("buy_url" IS NULL OR "buy_url" ~ '^(https://|mailto:)')
);

-- A proof. While it is locked, `blob_pathname` names the WATERMARKED copy, so
-- every path that serves a photo (the grid, share links, ZIPs, exports, the
-- live display, previews) serves the watermark without knowing proofs exist.
-- The clean original is held here and read only by the two places that check
-- the viewer is `proof_by`. Releasing moves it back into `blob_pathname`.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "proof_by" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "proof_original_pathname" text;
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "proof_released_at" timestamp with time zone;

-- "Release all my proofs" in one event.
CREATE INDEX IF NOT EXISTS "media_locked_proofs_idx"
ON "media" ("event_id", "proof_by")
WHERE "proof_original_pathname" IS NOT NULL;

-- The change stamp from 0017 and 0030, now also moved by a release, so phones
-- holding a signed link to the watermarked copy resync onto the clean one.
DROP TRIGGER IF EXISTS "media_changed_at_trigger" ON "media";
CREATE TRIGGER "media_changed_at_trigger"
BEFORE UPDATE ON "media"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."visibility" IS DISTINCT FROM NEW."visibility"
  OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"
  OR OLD."album_id" IS DISTINCT FROM NEW."album_id"
  OR OLD."thumb_pathname" IS DISTINCT FROM NEW."thumb_pathname"
  OR OLD."poster_pathname" IS DISTINCT FROM NEW."poster_pathname"
  OR OLD."reaction_count" IS DISTINCT FROM NEW."reaction_count"
  OR OLD."comment_count" IS DISTINCT FROM NEW."comment_count"
  OR OLD."blob_pathname" IS DISTINCT FROM NEW."blob_pathname"
  OR OLD."proof_released_at" IS DISTINCT FROM NEW."proof_released_at"
)
EXECUTE FUNCTION media_stamp_changed_at();
