import { ensureContrast, galleryPalette, isLightColor, contrastRatio } from "./color";
import {
  GALLERY_TEMPLATES,
  KLIK_COLORS,
  fieldsForTemplate,
  templateByKey,
  templateHeading,
  type GalleryTemplate,
  type TemplateFields,
  type TemplateKey,
} from "./gallery-templates";
import { isLocale, type Locale } from "./i18n/locale";
import { MIN_QR_CONTRAST, safeColors } from "./qr-svg";
import { QR_STYLES, type QrStyle } from "./qr-shapes";

/**
 * QR-5: the printable QR sign, in the event's look.
 *
 * What the host sees on the sign page is the page that prints: the preview
 * and the printed sheet are the same markup at the same proportions (sized in
 * container units, see `.qs` in app/globals.css), so nothing is laid out twice.
 * This file is the part that does not need a browser: the paper sizes, the
 * options and what a plan may change, the words in each language, and the
 * colours, including the pair the QR code is drawn in, which is held to what a
 * phone camera can read before the page ever decodes it.
 */

export const SIGN_PAPERS = [
  { key: "a4", label: "A4", widthMm: 210, heightMm: 297, sheet: true },
  { key: "letter", label: "US Letter", widthMm: 215.9, heightMm: 279.4, sheet: true },
  { key: "a5", label: "A5", widthMm: 148, heightMm: 210, sheet: false },
  { key: "5x7", label: "5 × 7 in", widthMm: 127, heightMm: 177.8, sheet: false },
  { key: "4x6", label: "4 × 6 in", widthMm: 101.6, heightMm: 152.4, sheet: false },
] as const;

export type SignPaperKey = (typeof SIGN_PAPERS)[number]["key"];
export type SignPaper = (typeof SIGN_PAPERS)[number];

export function paperByKey(key: string): SignPaper {
  return SIGN_PAPERS.find((paper) => paper.key === key) ?? SIGN_PAPERS[0];
}

/** Four to a sheet only on a full sheet, where each quarter is a table card. */
export const SIGN_PER_PAGE = [1, 4] as const;
export type SignPerPage = (typeof SIGN_PER_PAGE)[number];

/** A colourway key, or this for the event's own colours on a plan that sets them. */
export const GALLERY_COLORWAY = "gallery";

export const SIGN_HEADLINE_MAX = 60;
export const SIGN_TITLE_MAX = 80;

export interface SignOptions {
  look: TemplateKey;
  colorway: string;
  paper: SignPaperKey;
  perPage: SignPerPage;
  qrStyle: QrStyle;
  /** The call to action over the code. Empty means the language's first preset. */
  headline: string;
  /** The big words. Empty means the look's own heading (names, name, event). */
  title: string;
  language: Locale;
  showDate: boolean;
  showMessage: boolean;
  showSteps: boolean;
  showAddress: boolean;
  showLogo: boolean;
  /** A dark look printed on white paper, for a home printer. */
  saveInk: boolean;
}

/** What the event's plan lets the host change on the sign. */
export interface SignCaps {
  /** Dots and rounded codes: Premium, as everywhere else (QR-2). */
  qrStyles: boolean;
  /** Taking the Klik mark off: Premium, which removes Klik branding. */
  hideLogo: boolean;
  /** The host's own colours rather than a colourway: Premium. */
  galleryColors: boolean;
}

export const SIGN_COPY: Record<
  Locale,
  {
    headlines: readonly string[];
    steps: readonly [string, string, string];
    noApp: string;
    orVisit: string;
    classOf: (year: string) => string;
  }
> = {
  en: {
    headlines: [
      "Scan to share your photos",
      "Share your photos and videos",
      "Be our photographer tonight",
      "Add your photos to our album",
    ],
    steps: ["Scan the code", "Add your photos and videos", "See everyone's in one gallery"],
    noApp: "No app, no sign-up",
    orVisit: "or visit",
    classOf: (year) => `Class of ${year}`,
  },
  es: {
    headlines: [
      "Escanea y comparte tus fotos",
      "Comparte tus fotos y videos",
      "Sé nuestro fotógrafo esta noche",
      "Añade tus fotos a nuestro álbum",
    ],
    steps: ["Escanea el código", "Sube tus fotos y videos", "Mira las de todos en una galería"],
    noApp: "Sin app y sin registro",
    orVisit: "o visita",
    classOf: (year) => `Generación ${year}`,
  },
};

export function signHeadline(options: Pick<SignOptions, "headline" | "language">): string {
  return options.headline.trim() || SIGN_COPY[options.language].headlines[0];
}

/**
 * Where the sign starts: the gallery's own look in the gallery's own colours,
 * so the first thing a host sees is the sign that matches what guests will
 * see after they scan.
 */
export function signDefaults(input: {
  look: TemplateKey;
  /** The colourway the event's colours are exactly, if they are one. */
  colorway: string | null;
  caps: SignCaps;
  language: Locale;
  hasDate: boolean;
  hasMessage: boolean;
}): SignOptions {
  const look = templateByKey(input.look) ?? GALLERY_TEMPLATES[0];
  const colorway = input.colorway && look.colorways.some((option) => option.key === input.colorway)
    ? input.colorway
    : input.caps.galleryColors
      ? GALLERY_COLORWAY
      : look.colorways[0].key;
  return {
    look: look.key,
    colorway,
    // Klik sells in the US first, where a home printer holds Letter.
    paper: "letter",
    perPage: 1,
    qrStyle: input.caps.qrStyles ? "rounded" : "classic",
    headline: "",
    title: "",
    language: input.language,
    showDate: input.hasDate,
    showMessage: input.hasMessage,
    showSteps: true,
    showAddress: true,
    showLogo: true,
    saveInk: false,
  };
}

/**
 * Options read back from storage or a request, held to what exists and to what
 * the plan allows. Anything unknown falls back to `defaults`, so an old saved
 * sign, or one saved on a plan that has since changed, still opens.
 */
export function cleanSignOptions(raw: unknown, defaults: SignOptions, caps: SignCaps): SignOptions {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof SignOptions) => (typeof input[key] === "boolean" ? (input[key] as boolean) : (defaults[key] as boolean));
  const text = (key: "headline" | "title", max: number) =>
    typeof input[key] === "string" ? (input[key] as string).slice(0, max) : defaults[key];

  const look = templateByKey(typeof input.look === "string" ? input.look : null) ?? templateByKey(defaults.look)!;
  const wantedColorway = typeof input.colorway === "string" ? input.colorway : defaults.colorway;
  const colorway =
    wantedColorway === GALLERY_COLORWAY
      ? caps.galleryColors
        ? GALLERY_COLORWAY
        : look.colorways[0].key
      : look.colorways.some((option) => option.key === wantedColorway)
        ? wantedColorway
        : look.colorways[0].key;

  const paper = SIGN_PAPERS.find((option) => option.key === input.paper) ?? paperByKey(defaults.paper);
  const perPage: SignPerPage = paper.sheet && input.perPage === 4 ? 4 : 1;
  const style = QR_STYLES.find((option) => option === input.qrStyle) ?? defaults.qrStyle;

  return {
    look: look.key,
    colorway,
    paper: paper.key,
    perPage,
    qrStyle: caps.qrStyles ? style : "classic",
    headline: text("headline", SIGN_HEADLINE_MAX),
    title: text("title", SIGN_TITLE_MAX),
    language: isLocale(input.language) ? input.language : defaults.language,
    showDate: bool("showDate"),
    showMessage: bool("showMessage"),
    showSteps: bool("showSteps"),
    showAddress: bool("showAddress"),
    showLogo: caps.hideLogo ? bool("showLogo") : true,
    saveInk: bool("saveInk"),
  };
}

export interface SignPalette {
  background: string;
  /** Body and title text, 7:1 on the background where it can be. */
  ink: string;
  /** Secondary text, 4.5:1. */
  muted: string;
  /** Ornament and emphasis, 3:1. */
  accent: string;
  /** Text on a block of the accent. */
  onAccent: string;
  /** What the code sits on: a card of its own on a dark sign. */
  qrCard: string;
  /** The modules. Always darker than `qrCard` and at least 4.5:1 against it. */
  qrInk: string;
  light: boolean;
}

/** The two colours the sign starts from, before contrast is worked out. */
export function signBaseColors(
  look: GalleryTemplate,
  colorway: string,
  galleryColors: { accent: string; background: string },
): { accent: string; background: string } {
  if (colorway === GALLERY_COLORWAY) return galleryColors;
  const found = look.colorways.find((option) => option.key === colorway) ?? look.colorways[0];
  return found ? { accent: found.accent, background: found.background } : { ...KLIK_COLORS };
}

/**
 * The sign's colours, held to the same contrast as the gallery
 * (`galleryPalette`). The code is drawn in the sign's own darkest colour on
 * its lightest, so it belongs to the design rather than being a black square
 * pasted on: the background colour on a cream card for a dark look, the accent
 * (or the ink) straight on the paper for a light one.
 */
export function signPalette(base: { accent: string; background: string }, saveInk: boolean): SignPalette {
  const darkSign = !isLightColor(base.background);
  const background = saveInk && darkSign ? "#ffffff" : base.background.toLowerCase();
  const palette = galleryPalette(base.accent, background);

  let qrCard: string;
  let qrInk: string;
  if (palette.light) {
    qrCard = background;
    qrInk =
      contrastRatio(palette.volt, background) >= MIN_QR_CONTRAST && !isLightColor(palette.volt)
        ? palette.volt
        : palette.paper;
  } else {
    qrCard = palette.paper;
    qrInk = ensureContrast(background, qrCard, 7);
  }
  const qr = safeColors(qrInk, qrCard);

  return {
    background,
    ink: palette.paper,
    muted: palette.muted,
    accent: palette.volt,
    onAccent: palette.onVolt,
    qrCard: qr.background,
    qrInk: qr.foreground,
    light: palette.light,
  };
}

/** The address as it reads on paper, without the scheme. */
export function printedAddress(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * How big the title is set, in percent of the sign's width, so a long name
 * still fits in two lines. Each face is given a rough width per character;
 * the sign page measures nothing, which keeps the preview and the print
 * identical whatever the screen.
 */
export function signTitleSize(title: string, look: TemplateKey, widthCqw?: number): number {
  const faces: Record<TemplateKey, { max: number; min: number; perChar: number; lines: number }> = {
    "black-tie": { max: 8.4, min: 3.6, perChar: 0.86, lines: 2 },
    "white-lace": { max: 13, min: 5.5, perChar: 0.42, lines: 2 },
    party: { max: 11, min: 4.4, perChar: 0.56, lines: 2 },
    diploma: { max: 7.6, min: 3.4, perChar: 0.84, lines: 2 },
    modern: { max: 11.5, min: 4.6, perChar: 0.56, lines: 3 },
    plain: { max: 10, min: 4.2, perChar: 0.52, lines: 2 },
  };
  const face = faces[look];
  const width = widthCqw ?? (look === "modern" ? 82 : 76);
  const longestWord = Math.max(...title.split(/\s+/).map((word) => word.length), 1);
  const byLength = (width * face.lines) / (Math.max(title.length, 1) * face.perChar);
  const byWord = width / (longestWord * face.perChar);
  return Math.max(face.min, Math.min(face.max, byLength, byWord));
}

/** Everything one sign shows, resolved. Drawn by components/qr-sign/qr-sign.tsx. */
export interface SignContent {
  look: TemplateKey;
  language: Locale;
  palette: SignPalette;
  /** Percent of the sign's width. */
  titleSize: number;
  title: string;
  /** A couple, set with the look's ampersand. Null once the host types a title. */
  names: [string, string] | null;
  age: number | null;
  classLine: string | null;
  school: string | null;
  date: string | null;
  message: string | null;
  headline: string;
  steps: readonly string[] | null;
  noApp: string;
  address: string | null;
  orVisit: string;
  showLogo: boolean;
  /** The code, as an SVG data URI that has been decoded in the page. */
  qrSrc: string;
}

/**
 * The words on the sign, from the host's options and the event. The look's
 * own fields (the couple, the age, the class year) come from what the host
 * wrote for the gallery, read through the sign's look, so a sign in a look the
 * gallery does not wear still says something sensible: the event's name.
 */
export function signContent(input: {
  options: SignOptions;
  eventName: string;
  fields: TemplateFields | null | undefined;
  /** The event's date as the sign's look prints it, or null. */
  dateLabel: string | null;
  url: string;
  palette: SignPalette;
  qrSrc: string;
}): SignContent {
  const { options } = input;
  const look = templateByKey(options.look) ?? GALLERY_TEMPLATES[0];
  const copy = SIGN_COPY[options.language];
  const fields = fieldsForTemplate(look, input.fields);
  const heading = templateHeading(look, fields, input.eventName);
  const custom = options.title.trim();
  const title = custom || heading.title;
  const age = look.key === "party" && fields.age ? fields.age : null;

  return {
    look: look.key,
    language: options.language,
    palette: input.palette,
    titleSize: signTitleSize(title, look.key, age ? 50 : undefined),
    title,
    names: custom ? null : heading.names,
    age,
    classLine: look.key === "diploma" && fields.classOf ? copy.classOf(fields.classOf) : null,
    school: look.key === "diploma" ? (fields.school ?? null) : null,
    date: options.showDate ? input.dateLabel : null,
    message: options.showMessage ? (fields.message ?? null) : null,
    headline: signHeadline(options),
    steps: options.showSteps ? copy.steps : null,
    noApp: copy.noApp,
    address: options.showAddress ? printedAddress(input.url) : null,
    orVisit: copy.orVisit,
    showLogo: options.showLogo,
    qrSrc: input.qrSrc,
  };
}

/** Whether this look has a message to show, so the option can say so. */
export function signHasMessage(look: TemplateKey, fields: TemplateFields | null | undefined): boolean {
  const template = templateByKey(look);
  return Boolean(template && fieldsForTemplate(template, fields).message);
}
