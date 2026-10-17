/**
 * The looks a host can give their gallery, on any plan, sorted by what kind of
 * event it is.
 *
 * A template is a whole look: its own typeface, how the gallery's name is set,
 * an ornament, and how photos sit on the page (lib and CSS share the key, see
 * `.look` in app/globals.css and components/guest/look-hero.tsx). Each comes in
 * a few colourways, and asks the host for a few words of its own: a couple's
 * names, whose birthday, which class graduates.
 *
 * Stored as `events.template_key` and `events.template_fields`. The colourway
 * is not stored on its own: it is the event's two colour columns, and what keeps
 * Premium's choose-your-own-colours worth paying for is `eventColors`. On a plan
 * that cannot customise, an event shows its colours only when they are exactly
 * one colourway's pair, and Klik's own otherwise.
 *
 * Every pair here is readable as it stands under `galleryPalette` (the accent
 * clears 3:1 on its background without being adjusted), which the tests hold
 * it to, so a swatch in the picker is exactly what guests get.
 */

export const OCCASIONS = [
  { key: "wedding", label: "Wedding", namePlaceholder: "Anita & Raj's wedding" },
  { key: "birthday", label: "Birthday", namePlaceholder: "Maya's 30th" },
  { key: "graduation", label: "Graduation", namePlaceholder: "Sam's graduation" },
  { key: "baby-shower", label: "Baby shower", namePlaceholder: "Baby Lee's shower" },
  { key: "reunion", label: "Family reunion", namePlaceholder: "The Okafor family reunion" },
  { key: "company", label: "Company party", namePlaceholder: "Northwind summer party" },
  { key: "other", label: "Something else", namePlaceholder: "Saturday at the lake" },
] as const;

export type OccasionKey = (typeof OCCASIONS)[number]["key"];

export interface Colorway {
  key: string;
  name: string;
  accent: string;
  background: string;
}

/** The words a look asks the host for. Every one is optional. */
export const TEMPLATE_FIELD_KEYS = ["names", "name", "age", "classOf", "school", "headline", "message"] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELD_KEYS)[number];

export interface TemplateFields {
  /** A wedding's couple, in the order the host wants them read. */
  names?: [string, string];
  /** Whose birthday, or who graduates. */
  name?: string;
  age?: number;
  /** "2026". Free text, because some schools write "Class of '26". */
  classOf?: string;
  school?: string;
  /** The big line, for a look that is not about one person. */
  headline?: string;
  /** One line under it: "Thank you for celebrating with us". */
  message?: string;
  /** The event's date, under the name. On unless the host turns it off. */
  showDate?: boolean;
}

export const TEMPLATE_FIELD_LIMITS = {
  name: 40,
  headline: 80,
  classOf: 16,
  school: 80,
  message: 140,
} as const;

export const TEMPLATE_KEYS = ["black-tie", "white-lace", "party", "diploma", "modern", "plain"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface GalleryTemplate {
  key: TemplateKey;
  name: string;
  description: string;
  /** The first is the default. */
  colorways: readonly Colorway[];
  /** What the host is asked to fill in, in that order. */
  fields: readonly TemplateFieldKey[];
  /** Where the picker suggests it. "Something else" shows every template. */
  occasions: readonly OccasionKey[];
  /** Sample words for the picker and the editor's placeholders. */
  sample: TemplateFields & { eventName: string };
}

/** Klik's own colours, which every gallery has unless something says otherwise. */
export const KLIK_COLORS = { accent: "#edee00", background: "#050505" } as const;

const ALL_OCCASIONS = OCCASIONS.map((occasion) => occasion.key);

export const PLAIN_TEMPLATE: GalleryTemplate = {
  key: "plain",
  name: "Plain",
  description: "Klik's own black and yellow, nothing added.",
  colorways: [{ key: "plain", name: "Klik", ...KLIK_COLORS }],
  fields: [],
  occasions: ALL_OCCASIONS,
  sample: { eventName: "Saturday at the lake" },
};

/**
 * Wedding looks lead, because that is what most hosts are buying for. The
 * colourway keys of the looks shipped on 2026-10-16 (ivory, midnight, sage,
 * confetti, ...) are kept as colourway keys here, so an event made with one
 * still matches, and now wears the whole look it belongs to.
 */
export const GALLERY_TEMPLATES: readonly GalleryTemplate[] = [
  {
    key: "black-tie",
    name: "Black tie",
    description: "Your names in Bodoni capitals on black, with a fine gold line.",
    colorways: [
      { key: "champagne", name: "Champagne", accent: "#d9bd8b", background: "#0c0b0a" },
      { key: "midnight", name: "Midnight", accent: "#e6cf9f", background: "#0f1420" },
      { key: "silver", name: "Silver", accent: "#c9cdd3", background: "#0b0c0e" },
      { key: "rose-gold", name: "Rose gold", accent: "#e3b4a1", background: "#110d0c" },
    ],
    fields: ["names", "message"],
    occasions: ["wedding", "company"],
    sample: { eventName: "Ana & Bo's wedding", names: ["Ana", "Bo"], message: "Thank you for celebrating with us" },
  },
  {
    key: "white-lace",
    name: "White lace",
    description: "Your names in calligraphy on white, with a sprig between them.",
    colorways: [
      { key: "white", name: "White and gold", accent: "#8b6b3d", background: "#fffdf9" },
      { key: "ivory", name: "Ivory", accent: "#8a6a3b", background: "#f6f1e6" },
      { key: "sage", name: "Sage", accent: "#3f6b4e", background: "#eef3ec" },
      { key: "dusty-blue", name: "Dusty blue", accent: "#48627e", background: "#f5f7fa" },
    ],
    fields: ["names", "message"],
    occasions: ["wedding", "baby-shower"],
    sample: { eventName: "Ana & Bo's wedding", names: ["Ana", "Bo"], message: "Thank you for celebrating with us" },
  },
  {
    key: "party",
    name: "Party",
    description: "Big round letters, the age as a giant number, confetti.",
    colorways: [
      { key: "confetti", name: "Confetti", accent: "#ff4f8b", background: "#1c0f22" },
      { key: "sunshine", name: "Sunshine", accent: "#c2410c", background: "#fff6e0" },
      { key: "sorbet", name: "Sorbet", accent: "#b8456b", background: "#fdf0f2" },
      { key: "porch-light", name: "Porch light", accent: "#f5a524", background: "#14100b" },
    ],
    fields: ["name", "age", "message"],
    occasions: ["birthday", "baby-shower", "reunion"],
    sample: { eventName: "Maya's 30th", name: "Maya", age: 30, message: "Add every photo from tonight" },
  },
  {
    key: "diploma",
    name: "Diploma",
    description: "Roman capitals in a double frame, the class year in laurels.",
    colorways: [
      { key: "cap-and-gown", name: "Cap and gown", accent: "#f2c14e", background: "#0c1626" },
      { key: "varsity", name: "Varsity", accent: "#f1e3c6", background: "#5a1a1f" },
      { key: "chalkboard", name: "Chalkboard", accent: "#7ee0b5", background: "#141a17" },
    ],
    fields: ["name", "classOf", "school", "message"],
    occasions: ["graduation"],
    sample: { eventName: "Sam's graduation", name: "Sam Rivera", classOf: "2026", school: "Westfield High School" },
  },
  {
    key: "modern",
    name: "Modern",
    description: "A big, tight headline for any kind of event.",
    colorways: [
      { key: "cobalt", name: "Cobalt", accent: "#1f5eff", background: "#f5f6f8" },
      { key: "after-hours", name: "After hours", accent: "#5cb8ff", background: "#0a0c10" },
      { key: "graphite", name: "Graphite", accent: "#1b1b19", background: "#efeee9" },
    ],
    fields: ["headline", "message"],
    occasions: ALL_OCCASIONS,
    sample: { eventName: "Northwind summer party", headline: "Northwind summer party", message: "Share what you shoot" },
  },
  PLAIN_TEMPLATE,
];

export function templateByKey(key: string | null | undefined): GalleryTemplate | null {
  return GALLERY_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** The looks made for this kind of event, then Modern and Plain, or all of them. */
export function templatesFor(occasion: OccasionKey | null): readonly GalleryTemplate[] {
  if (!occasion || occasion === "other") return GALLERY_TEMPLATES;
  return GALLERY_TEMPLATES.filter((template) => template.occasions.includes(occasion));
}

/** The template and colourway these exact colours came from, if any. */
export function matchColorway(
  accent: string | null | undefined,
  background: string | null | undefined,
): { template: GalleryTemplate; colorway: Colorway } | null {
  if (!accent || !background) return null;
  const a = accent.toLowerCase();
  const b = background.toLowerCase();
  for (const template of GALLERY_TEMPLATES) {
    const colorway = template.colorways.find((option) => option.accent === a && option.background === b);
    if (colorway) return { template, colorway };
  }
  return null;
}

/** The template these exact colours belong to, if any. */
export function matchTemplate(accent: string | null | undefined, background: string | null | undefined) {
  return matchColorway(accent, background)?.template ?? null;
}

/**
 * What a template key from a request means. A look's own key is that look in
 * its first colourway; a colourway's key (which is what the create form sent
 * before 2026-10-17, and a tab left open since may still send) is that look in
 * that colourway.
 */
export function resolveTemplateChoice(
  key: string | null | undefined,
  colorwayKey?: string | null,
): { template: GalleryTemplate; colorway: Colorway } | null {
  const template = templateByKey(key);
  if (template) {
    const colorway = template.colorways.find((option) => option.key === colorwayKey) ?? template.colorways[0];
    return { template, colorway };
  }
  for (const candidate of GALLERY_TEMPLATES) {
    const colorway = candidate.colorways.find((option) => option.key === key);
    if (colorway) return { template: candidate, colorway };
  }
  return null;
}

/**
 * The look an event wears: the one its host chose, else the one its colours
 * came from (every event made before looks were stored), else Plain.
 */
export function eventTemplate(event: {
  templateKey?: string | null;
  accentColor: string;
  backgroundColor: string;
}): GalleryTemplate {
  return templateByKey(event.templateKey) ?? matchTemplate(event.accentColor, event.backgroundColor) ?? PLAIN_TEMPLATE;
}

/**
 * The colours an event's gallery is shown in. A plan that can customise shows
 * whatever the host chose; any other plan shows a colourway's colours when the
 * event carries one, and Klik's own otherwise.
 */
export function eventColors(
  event: { accentColor: string; backgroundColor: string },
  canCustomize: boolean,
): { accent: string; background: string } {
  if (canCustomize) return { accent: event.accentColor, background: event.backgroundColor };
  const match = matchColorway(event.accentColor, event.backgroundColor);
  return match ? { accent: match.colorway.accent, background: match.colorway.background } : { ...KLIK_COLORS };
}

/** Only the fields this look asks for, trimmed, with empty ones dropped. */
export function fieldsForTemplate(template: GalleryTemplate, fields: TemplateFields | null | undefined): TemplateFields {
  const out: TemplateFields = {};
  if (!fields) return out;
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  for (const key of template.fields) {
    if (key === "names") {
      const [a, b] = Array.isArray(fields.names) ? fields.names : [];
      const first = text(a, TEMPLATE_FIELD_LIMITS.name) ?? "";
      const second = text(b, TEMPLATE_FIELD_LIMITS.name) ?? "";
      if (first || second) out.names = [first, second];
    } else if (key === "age") {
      if (typeof fields.age === "number" && Number.isInteger(fields.age) && fields.age > 0 && fields.age < 130) {
        out.age = fields.age;
      }
    } else if (key === "name") {
      const value = text(fields.name, TEMPLATE_FIELD_LIMITS.name);
      if (value) out.name = value;
    } else {
      const value = text(fields[key], TEMPLATE_FIELD_LIMITS[key]);
      if (value) out[key] = value;
    }
  }
  if (fields.showDate === false) out.showDate = false;
  return out;
}

/**
 * The words a gallery is headed with. The host's own where they gave them,
 * the event's name otherwise, so a look with nothing filled in still reads.
 */
export function templateHeading(
  template: GalleryTemplate,
  fields: TemplateFields,
  eventName: string,
): { names: [string, string] | null; title: string } {
  if (template.fields.includes("names") && fields.names) {
    const [a, b] = fields.names;
    if (a && b) return { names: [a, b], title: `${a} & ${b}` };
    if (a || b) return { names: null, title: a || b };
  }
  if (template.fields.includes("name") && fields.name) return { names: null, title: fields.name };
  if (template.fields.includes("headline") && fields.headline) return { names: null, title: fields.headline };
  return { names: null, title: eventName };
}
