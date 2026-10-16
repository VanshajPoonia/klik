"use client";

import Image from "next/image";
import { galleryPalette } from "@/lib/color";
import {
  OCCASIONS,
  templatesFor,
  type GalleryTemplate,
  type OccasionKey,
} from "@/lib/gallery-templates";

const legendClass = "mb-2 block text-xs font-medium tracking-wide text-muted uppercase";

/** A sample photo and name per kind of event, so each look is seen with a picture in it. */
const SAMPLE: Record<OccasionKey, { photo: string; title: string }> = {
  wedding: { photo: "/images/sample-events/wedding-reception.png", title: "Ana & Bo" },
  birthday: { photo: "/images/sample-events/birthday-party.png", title: "Maya's 30th" },
  "baby-shower": { photo: "/images/sample-events/baby-shower.png", title: "Baby Lee" },
  graduation: { photo: "/images/sample-events/graduation.png", title: "Sam graduates" },
  reunion: { photo: "/images/sample-events/family-reunion.png", title: "The Okafors" },
  company: { photo: "/images/sample-events/company-party.png", title: "Summer party" },
  other: { photo: "/images/sample-events/wedding-reception.png", title: "Ana & Bo" },
};

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
 * The looks for a kind of event, Plain first, each drawn as a small gallery in
 * its own colours through the same palette the real gallery uses.
 */
export function TemplatePicker({
  occasion,
  value,
  onChange,
  legend = "Pick a look for the gallery",
  hint,
}: {
  occasion: OccasionKey | null;
  value: string | null;
  onChange: (template: GalleryTemplate) => void;
  legend?: string;
  hint?: string;
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
            sample={SAMPLE[occasion ?? template.occasions[0] ?? "other"]}
            checked={value === template.key}
            onSelect={() => onChange(template)}
          />
        ))}
      </div>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}

function TemplateCard({
  template,
  sample,
  checked,
  onSelect,
}: {
  template: GalleryTemplate;
  sample: { photo: string; title: string };
  checked: boolean;
  onSelect: () => void;
}) {
  const palette = galleryPalette(template.accent, template.background);
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
        className="block overflow-hidden rounded-lg p-2.5"
        style={{ backgroundColor: template.background }}
        aria-hidden="true"
      >
        <span className="block truncate font-display text-sm leading-tight" style={{ color: palette.paper }}>
          {sample.title}
        </span>
        <span className="mt-0.5 block text-[10px]" style={{ color: palette.muted }}>
          48 photos
        </span>
        <span className="mt-2 grid grid-cols-3 gap-1">
          <span className="relative col-span-2 row-span-2 aspect-square overflow-hidden rounded-[3px]">
            <Image src={sample.photo} alt="" fill sizes="160px" className="object-cover" />
          </span>
          <span className="aspect-square rounded-[3px]" style={{ backgroundColor: palette.muted, opacity: 0.35 }} />
          <span className="aspect-square rounded-[3px]" style={{ backgroundColor: palette.muted, opacity: 0.2 }} />
        </span>
        <span
          className="mt-2 inline-block rounded-full px-2.5 py-1 text-[10px] font-medium"
          style={{ backgroundColor: palette.volt, color: palette.onVolt }}
        >
          Add photos
        </span>
      </span>
      <span className="block px-1 pb-0.5 pt-2">
        <span className="block text-sm font-medium text-paper">{template.name}</span>
        <span className="block text-xs leading-snug text-muted">{template.description}</span>
      </span>
    </label>
  );
}
