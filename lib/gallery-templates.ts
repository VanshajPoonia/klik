/**
 * The looks a host can pick for their gallery when they create an event, on
 * any plan, sorted by what kind of event it is.
 *
 * A template is nothing more than an accent and a background, written to the
 * event's own two colour columns, so there is no template column to keep in
 * step and the gallery needs no new code path. What keeps Premium's choose-
 * your-own-colours worth paying for is `eventColors`: on a plan that cannot
 * customise, an event shows its colours only when they are exactly one of the
 * pairs below, and Klik's own otherwise.
 *
 * Every pair here is readable as it stands under `galleryPalette` (the accent
 * clears 3:1 on its background without being adjusted), which the tests hold
 * it to, so a swatch in the picker is exactly what guests get.
 */

export const OCCASIONS = [
  { key: "wedding", label: "Wedding", namePlaceholder: "Anita & Raj's wedding" },
  { key: "birthday", label: "Birthday", namePlaceholder: "Maya's 30th" },
  { key: "baby-shower", label: "Baby shower", namePlaceholder: "Baby Lee's shower" },
  { key: "graduation", label: "Graduation", namePlaceholder: "Sam's graduation" },
  { key: "reunion", label: "Family reunion", namePlaceholder: "The Okafor family reunion" },
  { key: "company", label: "Company party", namePlaceholder: "Northwind summer party" },
  { key: "other", label: "Something else", namePlaceholder: "Anita & Raj's wedding" },
] as const;

export type OccasionKey = (typeof OCCASIONS)[number]["key"];

export interface GalleryTemplate {
  key: string;
  name: string;
  description: string;
  accent: string;
  background: string;
  /** Where the picker suggests it. "Something else" shows every template. */
  occasions: readonly OccasionKey[];
}

/** Klik's own colours, which every gallery has unless something says otherwise. */
export const KLIK_COLORS = { accent: "#edee00", background: "#050505" } as const;

export const PLAIN_TEMPLATE: GalleryTemplate = {
  key: "plain",
  name: "Plain",
  description: "Klik's own black and yellow.",
  ...KLIK_COLORS,
  occasions: OCCASIONS.map((occasion) => occasion.key),
};

export const GALLERY_TEMPLATES: readonly GalleryTemplate[] = [
  PLAIN_TEMPLATE,
  {
    key: "ivory",
    name: "Ivory",
    description: "Antique gold on warm ivory.",
    accent: "#8a6a3b",
    background: "#f6f1e6",
    occasions: ["wedding", "baby-shower"],
  },
  {
    key: "midnight",
    name: "Midnight",
    description: "Champagne on midnight blue.",
    accent: "#e6cf9f",
    background: "#0f1420",
    occasions: ["wedding", "company"],
  },
  {
    key: "confetti",
    name: "Confetti",
    description: "Hot pink on deep plum.",
    accent: "#ff4f8b",
    background: "#1c0f22",
    occasions: ["birthday"],
  },
  {
    key: "sunshine",
    name: "Sunshine",
    description: "Tangerine on butter cream.",
    accent: "#c2410c",
    background: "#fff6e0",
    occasions: ["birthday", "reunion"],
  },
  {
    key: "sorbet",
    name: "Sorbet",
    description: "Rose on blush.",
    accent: "#b8456b",
    background: "#fdf0f2",
    occasions: ["baby-shower", "birthday"],
  },
  {
    key: "sage",
    name: "Sage",
    description: "Leaf green on soft sage.",
    accent: "#3f6b4e",
    background: "#eef3ec",
    occasions: ["baby-shower", "wedding"],
  },
  {
    key: "cap-and-gown",
    name: "Cap and gown",
    description: "Gold on navy.",
    accent: "#f2c14e",
    background: "#0c1626",
    occasions: ["graduation"],
  },
  {
    key: "chalkboard",
    name: "Chalkboard",
    description: "Mint on slate.",
    accent: "#7ee0b5",
    background: "#141a17",
    occasions: ["graduation", "reunion"],
  },
  {
    key: "porch-light",
    name: "Porch light",
    description: "Amber on a warm dark.",
    accent: "#f5a524",
    background: "#14100b",
    occasions: ["reunion", "birthday"],
  },
  {
    key: "after-hours",
    name: "After hours",
    description: "Electric blue on black.",
    accent: "#5cb8ff",
    background: "#0a0c10",
    occasions: ["company", "graduation"],
  },
  {
    key: "cobalt",
    name: "Cobalt",
    description: "Cobalt on paper white.",
    accent: "#1f5eff",
    background: "#f5f6f8",
    occasions: ["company"],
  },
];

export const TEMPLATE_KEYS = GALLERY_TEMPLATES.map((template) => template.key) as [string, ...string[]];

export function templateByKey(key: string | null | undefined): GalleryTemplate | null {
  return GALLERY_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** Plain first, then the ones made for this kind of event, or all of them. */
export function templatesFor(occasion: OccasionKey | null): readonly GalleryTemplate[] {
  if (!occasion || occasion === "other") return GALLERY_TEMPLATES;
  return GALLERY_TEMPLATES.filter((template) => template.occasions.includes(occasion));
}

/** The template these exact colours came from, if any. */
export function matchTemplate(accent: string | null | undefined, background: string | null | undefined) {
  if (!accent || !background) return null;
  const a = accent.toLowerCase();
  const b = background.toLowerCase();
  return GALLERY_TEMPLATES.find((template) => template.accent === a && template.background === b) ?? null;
}

/**
 * The colours an event's gallery is shown in. A plan that can customise shows
 * whatever the host chose; any other plan shows a template's colours when the
 * event carries one, and Klik's own otherwise.
 */
export function eventColors(
  event: { accentColor: string; backgroundColor: string },
  canCustomize: boolean,
): { accent: string; background: string } {
  if (canCustomize) return { accent: event.accentColor, background: event.backgroundColor };
  const template = matchTemplate(event.accentColor, event.backgroundColor);
  return template ? { accent: template.accent, background: template.background } : { ...KLIK_COLORS };
}
