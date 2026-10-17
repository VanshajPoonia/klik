-- TPL-1: a gallery's look, and the words its host gave it. See
-- lib/gallery-templates.ts. Re-runnable.
--
-- Both nullable with no backfill. A null template_key means "whatever look the
-- event's colours belong to", which is every event made before this, so none
-- of them changes colour and each one made with a colour template now wears
-- the whole look that template became. A null template_fields is "nothing
-- filled in", and the gallery is headed with the event's name as before.
--
-- No CHECK on template_key: a key this build does not know falls back to Plain
-- in eventTemplate(), which is safer than refusing an older deployment's write.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "template_key" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "template_fields" jsonb;
