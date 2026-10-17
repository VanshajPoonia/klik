"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { galleryPalette } from "@/lib/color";
import { galleryContentTheme } from "@/components/guest/gallery-theme";
import { LookHero } from "@/components/guest/look-hero";
import {
  OCCASIONS,
  templatesFor,
  type Colorway,
  type GalleryTemplate,
  type OccasionKey,
  type TemplateFields,
} from "@/lib/gallery-templates";

const legendClass = "mb-2 block text-xs font-medium tracking-wide text-muted uppercase";

/** A sample photo per look, so each one is seen with a picture in it. */
const SAMPLE_PHOTO: Record<string, string> = {
  "black-tie": "/images/sample-events/wedding-reception.png",
  "white-lace": "/images/sample-events/wedding-reception.png",
  party: "/images/sample-events/birthday-party.png",
  diploma: "/images/sample-events/graduation.png",
  modern: "/images/sample-events/company-party.png",
  plain: "/images/sample-events/family-reunion.png",
};

/** A Saturday in June, so every date line in the picker has something to say. */
const SAMPLE_DATE = "2026-06-13T00:00:00.000Z";

/** The first question on a new event: what it is, which decides the looks offered. */
export function OccasionPicker({
  value,
  onChange,
}: {
  value: OccasionKey | null;
  onChange: (next: OccasionKey) => void;
}) {
  return (
    <fieldset>
      <legend className={legendClass}>What kind of event is it?</legend>
      <div className="flex flex-wrap gap-2">
        {OCCASIONS.map((occasion) => (
          <label
            key={occasion.key}
            className="cursor-pointer rounded-full border border-canvas-line px-4 py-2 text-sm text-paper transition-colors hover:border-paper/40 has-[:checked]:border-volt has-[:checked]:bg-volt has-[:checked]:text-on-volt has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-volt has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas"
          >
            <input
              type="radio"
              name="occasion"
              value={occasion.key}
              checked={value === occasion.key}
              onChange={() => onChange(occasion.key)}
              className="sr-only"
            />
            {occasion.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The looks for a kind of event, each drawn as a small gallery: the real
 * header (LookHero) in its own type and ornament, in a colourway, over tiles
 * set the way the look sets them. `colorwayFor` lets the chosen look show the
 * colourway picked for it while the others show their first.
 */
export function TemplatePicker({
  occasion,
  value,
  onChange,
  legend = "Pick a look for the gallery",
  hint,
  colorwayFor,
  fieldsFor,
}: {
  occasion: OccasionKey | null;
  value: string | null;
  onChange: (template: GalleryTemplate) => void;
  legend?: string;
  hint?: string;
  colorwayFor?: (template: GalleryTemplate) => Colorway | null;
  /** The host's own words, for the chosen look, so its card reads as theirs. */
  fieldsFor?: (template: GalleryTemplate) => TemplateFields | null;
}) {
  const templates = templatesFor(occasion);
  return (
    <fieldset>
      <legend className={legendClass}>{legend}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.key}
            template={template}
            colorway={colorwayFor?.(template) ?? template.colorways[0]}
            fields={fieldsFor?.(template) ?? null}
            checked={value === template.key}
            onSelect={() => onChange(template)}
          />
        ))}
      </div>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

/** The colourways of one look, as swatches of its background with the accent in it. */
export function ColorwayPicker({
  template,
  value,
  onChange,
  legend = "Colours",
}: {
  template: GalleryTemplate;
  value: string | null;
  onChange: (colorway: Colorway) => void;
  legend?: string;
}) {
  if (template.colorways.length < 2) return null;
  return (
    <fieldset>
      <legend className={legendClass}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {template.colorways.map((colorway) => {
          const palette = galleryPalette(colorway.accent, colorway.background);
          return (
            <label
              key={colorway.key}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border border-canvas-line py-1.5 pl-1.5 pr-4 text-sm text-paper transition-colors hover:border-paper/40 has-[:checked]:border-volt has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-volt has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas"
            >
              <input
                type="radio"
                name={`colorway-${template.key}`}
                value={colorway.key}
                checked={value === colorway.key}
                onChange={() => onChange(colorway)}
                className="sr-only"
              />
              <span
                className="relative flex h-8 w-8 items-center justify-center rounded-full border border-canvas-line"
                style={{ backgroundColor: colorway.background }}
                aria-hidden="true"
              >
                <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: palette.volt }} />
              </span>
              {colorway.name}
              {value === colorway.key && <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TemplateCard({
  template,
  colorway,
  fields,
  checked,
  onSelect,
}: {
  template: GalleryTemplate;
  colorway: Colorway;
  fields: TemplateFields | null;
  checked: boolean;
  onSelect: () => void;
}) {
  const palette = galleryPalette(colorway.accent, colorway.background);
  const photo = SAMPLE_PHOTO[template.key] ?? SAMPLE_PHOTO.plain;
  const words = fields && Object.keys(fields).length > 0 ? fields : template.sample;
  return (
    <label className="group block cursor-pointer rounded-xl border border-canvas-line p-1.5 transition-colors hover:border-paper/40 has-[:checked]:border-volt has-[:checked]:ring-1 has-[:checked]:ring-volt has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-volt has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas">
      <input
        type="radio"
        name="gallery-template"
        value={template.key}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className="look block overflow-hidden rounded-lg px-3 pb-3 pt-4"
        data-look={template.key}
        style={{ backgroundColor: colorway.background, ...galleryContentTheme(colorway.accent, colorway.background) }}
        aria-hidden="true"
      >
        {template.key === "plain" ? (
          <>
            <span className="block truncate font-display text-sm leading-tight" style={{ color: palette.paper }}>
              {template.sample.eventName}
            </span>
            <span className="mt-0.5 block text-[10px]" style={{ color: palette.muted }}>
              48 photos
            </span>
          </>
        ) : (
          <LookHero
            templateKey={template.key}
            fields={words}
            eventName={template.sample.eventName}
            eventDate={SAMPLE_DATE}
            locale="en"
            size="card"
            heading="p"
          />
        )}
        <span className="look-grid mt-3 grid grid-cols-3" style={{ ["--look-gap" as string]: "4px" }}>
          <span className="look-tile relative col-span-2 row-span-2 aspect-square overflow-hidden">
            <Image src={photo} alt="" fill sizes="160px" className="object-cover" />
          </span>
          <span className="look-tile aspect-square" style={{ backgroundColor: palette.muted, opacity: 0.35 }} />
          <span className="look-tile aspect-square" style={{ backgroundColor: palette.muted, opacity: 0.2 }} />
        </span>
      </span>
      <span className="block px-1 pb-0.5 pt-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-paper">
          {template.name}
          {checked && <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />}
        </span>
        <span className="block text-xs leading-snug text-muted">{template.description}</span>
      </span>
    </label>
  );
}
