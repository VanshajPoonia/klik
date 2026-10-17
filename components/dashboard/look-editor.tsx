"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { galleryPalette } from "@/lib/color";
import { toDateInputValue } from "@/lib/dates";
import type { OrganizerEvent } from "@/lib/events";
import type { Media } from "@/lib/schema";
import {
  eventTemplate,
  fieldsForTemplate,
  matchColorway,
  type Colorway,
  type GalleryTemplate,
  type TemplateFields,
} from "@/lib/gallery-templates";
import { galleryContentTheme } from "@/components/guest/gallery-theme";
import { LookHero } from "@/components/guest/look-hero";
import { ColorwayPicker, TemplatePicker } from "@/components/dashboard/template-picker";
import { LookFields, lookFieldsPayload } from "@/components/dashboard/look-fields";

const COVER_CHOICES = 30;
const SAMPLE_TILES = [
  "/images/sample-events/wedding-reception.png",
  "/images/sample-events/birthday-party.png",
  "/images/sample-events/family-reunion.png",
  "/images/sample-events/company-party.png",
  "/images/sample-events/graduation.png",
  "/images/sample-events/baby-shower.png",
];

type ApprovedPhoto = Media & { thumbSrc?: string | null };

/**
 * TPL-1: the Look tab. Which look the gallery wears, in which colours, and the
 * host's own words for it (a couple's names, a date), beside a phone-width
 * preview drawn by the same LookHero guests get, in the same palette.
 *
 * Everything about how the gallery looks is saved from here, Premium's own
 * colours and cover included, so the Settings form no longer sends colours of
 * its own and the two cannot overwrite each other.
 */
export function LookEditor({
  event,
  canCustomizeGallery,
  approvedMedia,
}: {
  event: OrganizerEvent;
  canCustomizeGallery: boolean;
  approvedMedia: ApprovedPhoto[];
}) {
  const router = useRouter();
  const initial = eventTemplate(event);
  const initialMatch = matchColorway(event.accentColor, event.backgroundColor);
  const [templateKey, setTemplateKey] = useState<GalleryTemplate["key"]>(initial.key);
  const [colorwayKey, setColorwayKey] = useState<string | null>(
    initialMatch && initialMatch.template.key === initial.key ? initialMatch.colorway.key : canCustomizeGallery ? null : initial.colorways[0].key,
  );
  // Premium's own colours, used whenever no colourway is picked.
  const [accent, setAccent] = useState(event.accentColor);
  const [background, setBackground] = useState(event.backgroundColor);
  // One set of words across looks, so a couple switching from Black tie to
  // White lace keeps their names. The server keeps only what the look uses.
  const [fields, setFields] = useState<TemplateFields>(event.templateFields ?? {});
  const [eventDate, setEventDate] = useState(toDateInputValue(event.eventDate));
  const [coverMediaId, setCoverMediaId] = useState(event.coverMediaId ?? "");
  const [preview, setPreview] = useState<"sheet" | "page">("sheet");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const template = eventTemplate({ templateKey, accentColor: accent, backgroundColor: background });
  const colorway: Colorway | null = template.colorways.find((option) => option.key === colorwayKey) ?? null;
  const colors = colorway ? { accent: colorway.accent, background: colorway.background } : { accent, background };
  const palette = galleryPalette(colors.accent, colors.background);
  const shown = fieldsForTemplate(template, fields);
  const photos = approvedMedia.filter((item) => item.kind === "photo");
  const tiles = useMemo(
    () =>
      photos.length > 0
        ? photos.slice(0, 6).map((photo) => photo.thumbSrc ?? `${photo.blobUrl}?thumb=1`)
        : SAMPLE_TILES,
    [photos],
  );

  function chooseTemplate(next: GalleryTemplate) {
    setTemplateKey(next.key);
    // A colourway belongs to its look, so a new look starts on its own first.
    setColorwayKey(next.colorways[0].key);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateKey,
          templateFields: lookFieldsPayload(fields),
          eventDate: eventDate || null,
          // A colourway on any plan, colours of one's own on Premium.
          ...(colorway || canCustomizeGallery ? { accentColor: colors.accent, backgroundColor: colors.background } : {}),
          ...(canCustomizeGallery ? { coverMediaId: coverMediaId || null } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save the look");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not save the look. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="space-y-7">
        <TemplatePicker
          occasion={null}
          legend="Look"
          value={templateKey}
          onChange={chooseTemplate}
          colorwayFor={(option) => (option.key === templateKey ? colorway : null)}
          fieldsFor={(option) => (option.key === templateKey ? shown : null)}
          hint="Every look comes with every plan."
        />

        <div className="space-y-4">
          <ColorwayPicker
            template={template}
            value={colorwayKey}
            onChange={(next) => {
              setColorwayKey(next.key);
              setSaved(false);
            }}
          />
          {canCustomizeGallery && (
            <details className="group rounded-xl border border-canvas-line px-4 py-3" open={colorwayKey === null}>
              <summary className="cursor-pointer list-none text-sm text-paper [&::-webkit-details-marker]:hidden">
                Your own colours <span className="text-muted">(Premium)</span>
              </summary>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Accent">
                    <input
                      type="color"
                      className={`${inputClass} h-11 p-1`}
                      value={colors.accent}
                      onChange={(change) => {
                        setAccent(change.target.value);
                        setBackground(colors.background);
                        setColorwayKey(null);
                      }}
                    />
                  </Field>
                  <Field label="Background">
                    <input
                      type="color"
                      className={`${inputClass} h-11 p-1`}
                      value={colors.background}
                      onChange={(change) => {
                        setBackground(change.target.value);
                        setAccent(colors.accent);
                        setColorwayKey(null);
                      }}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted">
                  {palette.accentAdjusted
                    ? "Your accent is a little darker or lighter on this background where it is a button or a link, so everyone can read it."
                    : "Text and buttons are checked to stay readable for everyone."}
                </p>
              </div>
            </details>
          )}
        </div>

        {template.fields.length > 0 && (
          <fieldset className="space-y-4 border-t border-canvas-line pt-6">
            <legend className="sr-only">Your words</legend>
            <LookFields template={template} value={fields} onChange={(next) => { setFields(next); setSaved(false); }} />
            <Field label="Date">
              <input
                type="date"
                className={inputClass}
                value={eventDate}
                onChange={(change) => {
                  setEventDate(change.target.value);
                  setSaved(false);
                }}
              />
            </Field>
          </fieldset>
        )}

        {canCustomizeGallery && <CoverPicker photos={photos} value={coverMediaId} onChange={setCoverMediaId} />}

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-4">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save look"}
          </Button>
          {saved && (
            <p className="text-sm text-muted" role="status">
              Saved. Guests see it the next time the gallery loads.
            </p>
          )}
        </div>
      </Card>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex gap-1 rounded-full border border-canvas-line p-1" role="group" aria-label="Preview">
          {(
            [
              ["sheet", "After scanning"],
              ["page", "The gallery"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreview(key)}
              aria-pressed={preview === key}
              className={`min-h-9 flex-1 rounded-full px-3 text-sm transition-colors ${
                preview === key ? "bg-volt text-on-volt" : "text-muted hover:text-paper"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* A phone's width, because that is where guests see it. */}
        <div
          className="look mx-auto max-h-[44rem] w-full max-w-[24rem] overflow-hidden rounded-[1.75rem] border border-canvas-line"
          data-look={template.key}
          style={{
            backgroundColor: colors.background,
            ["--event-accent" as string]: colors.accent,
            ...galleryContentTheme(colors.accent, colors.background),
          }}
          aria-label={`Preview of ${template.name}`}
          role="img"
        >
          <div className="look-page px-6 pb-8 pt-10" data-look={template.key}>
            {preview === "sheet" ? (
              <>
                {template.key === "plain" ? (
                  <p className="text-center font-display text-2xl text-paper">{event.name}</p>
                ) : (
                  <LookHero
                    templateKey={template.key}
                    fields={shown}
                    eventName={event.name}
                    eventDate={eventDate ? `${eventDate}T00:00:00.000Z` : null}
                    locale="en"
                    size="sheet"
                    heading="p"
                  />
                )}
                <p className="mt-8 text-center text-sm text-muted">Join the shared gallery.</p>
                <div className="mt-5 space-y-3">
                  <div className="h-11 rounded-xl border border-canvas-line" />
                  <div
                    className="flex h-11 items-center justify-center rounded-full text-sm font-medium"
                    style={{ backgroundColor: palette.volt, color: palette.onVolt }}
                  >
                    Continue
                  </div>
                </div>
              </>
            ) : (
              <>
                {template.key === "plain" ? (
                  <p className="font-display text-2xl text-paper">{event.name}</p>
                ) : (
                  <LookHero
                    templateKey={template.key}
                    fields={shown}
                    eventName={event.name}
                    eventDate={eventDate ? `${eventDate}T00:00:00.000Z` : null}
                    locale="en"
                    size="page"
                    heading="p"
                  >
                    <p className="look-count mt-5 text-sm text-muted">{photos.length || 48} items shared</p>
                  </LookHero>
                )}
                <div
                  className={`mb-6 mt-6 flex gap-2 ${
                    template.key === "black-tie" || template.key === "white-lace" || template.key === "diploma"
                      ? "justify-center"
                      : ""
                  }`}
                >
                  <span
                    className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium"
                    style={{ backgroundColor: palette.volt, color: palette.onVolt }}
                  >
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    Camera
                  </span>
                  <span className="inline-flex min-h-10 items-center rounded-full border border-canvas-line px-4 text-sm text-paper">
                    Add media
                  </span>
                </div>
                <div className="look-grid grid grid-cols-2">
                  {tiles.map((src, index) => (
                    <span key={`${src}-${index}`} className="look-tile relative aspect-square overflow-hidden bg-canvas-raised">
                      <Image src={src} alt="" fill unoptimized sizes="180px" className="object-cover" />
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverPicker({
  photos,
  value,
  onChange,
}: {
  photos: ApprovedPhoto[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = photos.find((photo) => photo.id === value);
  const choices = photos.slice(0, COVER_CHOICES);
  if (selected && !choices.some((photo) => photo.id === selected.id)) {
    choices.unshift(selected);
  }

  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        Cover photo <span className="normal-case tracking-normal">(Premium)</span>
      </legend>
      {choices.length === 0 ? (
        <p className="text-sm text-muted">
          Approved photos show up here as guests add them, and you can pick one as the cover.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <button
            type="button"
            onClick={() => onChange("")}
            aria-pressed={value === ""}
            className={`flex aspect-square items-center justify-center rounded-lg border-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
              value === "" ? "border-volt text-paper" : "border-canvas-line text-muted hover:text-paper"
            }`}
          >
            None
          </button>
          {choices.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => onChange(photo.id)}
              aria-pressed={value === photo.id}
              aria-label={`Use photo ${index + 1} as the cover`}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                value === photo.id ? "border-volt" : "border-transparent hover:border-paper/40"
              }`}
            >
              <Image
                src={photo.thumbSrc ?? `${photo.blobUrl}?thumb=1`}
                alt=""
                fill
                unoptimized
                sizes="96px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
