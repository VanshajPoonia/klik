import { contrastRatio } from "../color";
import {
  PRINT_SCHEMA_VERSION,
  elementId,
  type EllipseElement,
  type IconElement,
  type LineElement,
  type PrintDoc,
  type PrintElement,
  type QrElement,
  type RectElement,
  type TextElement,
} from "./doc";
import { MM_PER_POINT } from "./fonts";
import type { PrintIconKey } from "./icons";

/**
 * QR-4d: the starter designs. Templates are the product here: a blank page
 * makes people leave, and a sign that already says the right thing in the
 * right place gets printed. Each is authored in the shipped identity (volt on
 * near-black, cream on black, minimal ink on cream or white) and filled with
 * the event's own name, date and gallery address when it is chosen.
 *
 * Every template is held by a test to the export checks for short and very
 * long event names, with the default accent and with a dark one: the code
 * large enough to scan, the contrast a camera needs, and nothing near the cut.
 */

export const INK = "#050505";
export const CREAM = "#f3f1e9";
export const WHITE = "#ffffff";
export const VOLT = "#edee00";
const STONE = "#5a5850";
const MIST = "#bdbab0";
const ASH = "#8c8a80";

export interface TemplateContext {
  eventName: string;
  /** "Saturday, June 14, 2026", or null when the event has no date. */
  dateLabel: string | null;
  /** The event's accent on a plan that sets one, else volt. */
  accent: string;
}

export interface PrintTemplate {
  key: string;
  name: string;
  /** One line for the gallery of templates. */
  blurb: string;
  preset: string;
  build: (context: TemplateContext) => PrintDoc;
}

/** "Saturday, June 14, 2026". Event dates are stored as UTC midnight. */
export function eventDateLabel(date: Date | null): string | null {
  return date
    ? date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
}

/**
 * A rough height for text before a browser has measured it: the studio
 * measures every text box once its fonts load, so this only has to be close
 * enough to lay a template out and to check it in a test.
 */
export function estimateTextHeight(text: string, sizePt: number, lineHeight: number, widthMm: number, uppercase = false): number {
  const sizeMm = sizePt * MM_PER_POINT;
  const perLine = Math.max(1, Math.floor(widthMm / (sizeMm * (uppercase ? 0.68 : 0.52))));
  const lines = text
    .split("\n")
    .reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  return Math.max(sizeMm, lines * sizeMm * lineHeight);
}

/** The largest size from `start` down that sets `text` in `maxLines` lines. */
export function fitTextSize(text: string, start: number, min: number, widthMm: number, maxLines: number, lineHeight: number): number {
  for (let size = start; size > min; size -= 1) {
    if (estimateTextHeight(text, size, lineHeight, widthMm) <= maxLines * size * MM_PER_POINT * lineHeight + 0.01) return size;
  }
  return min;
}

type TextInput = Partial<TextElement> & Pick<TextElement, "text" | "x" | "y" | "width" | "size">;

function text(input: TextInput): TextElement {
  const element: TextElement = {
    id: elementId(),
    type: "text",
    rotation: 0,
    opacity: 1,
    bind: null,
    font: "geist",
    weight: 400,
    italic: false,
    uppercase: false,
    align: "center",
    lineHeight: 1.2,
    tracking: 0,
    color: INK,
    height: 0,
    ...input,
  };
  element.height = input.height ?? estimateTextHeight(element.text, element.size, element.lineHeight, element.width, element.uppercase);
  return element;
}

function qr(input: Partial<QrElement> & Pick<QrElement, "x" | "y" | "width">): QrElement {
  return {
    id: elementId(),
    type: "qr",
    name: "QR code",
    rotation: 0,
    opacity: 1,
    style: "classic",
    foreground: INK,
    background: null,
    height: input.width,
    ...input,
  };
}

function rect(input: Partial<RectElement> & Pick<RectElement, "x" | "y" | "width" | "height">): RectElement {
  return { id: elementId(), type: "rect", rotation: 0, opacity: 1, fill: CREAM, stroke: null, strokeWidth: 0, radius: 0, ...input };
}

function ellipse(input: Partial<EllipseElement> & Pick<EllipseElement, "x" | "y" | "width" | "height">): EllipseElement {
  return { id: elementId(), type: "ellipse", rotation: 0, opacity: 1, fill: CREAM, stroke: null, strokeWidth: 0, ...input };
}

function line(input: Partial<LineElement> & Pick<LineElement, "x" | "y" | "width">): LineElement {
  return { id: elementId(), type: "line", rotation: 0, opacity: 1, height: 2, stroke: INK, strokeWidth: 0.35, dashed: false, ...input };
}

function icon(input: Partial<IconElement> & Pick<IconElement, "x" | "y" | "width" | "icon">): IconElement {
  return { id: elementId(), type: "icon", rotation: 0, opacity: 1, color: INK, height: input.width, ...input, icon: input.icon as PrintIconKey };
}

function page(background: string, elements: PrintElement[]): PrintDoc {
  return { schemaVersion: PRINT_SCHEMA_VERSION, background: { color: background, assetId: null }, elements, guides: { x: [], y: [] } };
}

/** The event's name, following it if it is renamed, sized to fit `maxLines`. */
function eventName(context: TemplateContext, input: Omit<TextInput, "text"> & { maxLines: number; minSize: number }): TextElement {
  const { maxLines, minSize, ...rest } = input;
  const lineHeight = rest.lineHeight ?? 1.08;
  const size = fitTextSize(context.eventName, rest.size, minSize, rest.width, maxLines, lineHeight);
  return text({ name: "Event name", ...rest, text: context.eventName, bind: "eventName", size, lineHeight });
}

function address(input: Omit<TextInput, "text">): TextElement {
  return text({ name: "Gallery address", ...input, text: "klik.kreativvantage.com/e/your-event", bind: "url" });
}

/** Ink on the accent where it reads clearly, else ink on cream. */
const onAccent = (accent: string) => (contrastRatio(INK, accent) >= 7 ? accent : CREAM);

/** The accent as type on black where it reads, else cream. */
const onDark = (accent: string) => (contrastRatio(accent, INK) >= 4.5 ? accent : CREAM);

export const PRINT_TEMPLATES: PrintTemplate[] = [
  {
    key: "poster-volt",
    name: "Poster",
    blurb: "A4, volt on black. For a wall by the entrance.",
    preset: "a4",
    build: (context) =>
      page(INK, [
        text({ text: "Scan to share", x: 20, y: 22, width: 170, size: 11, weight: 600, uppercase: true, tracking: 220, align: "left", color: context.accent }),
        eventName(context, { x: 20, y: 32, width: 170, size: 54, minSize: 30, maxLines: 2, font: "fraunces", weight: 600, align: "left", color: CREAM }),
        text({ text: "Every photo from today, in one place.", x: 20, y: 84, width: 170, size: 16, align: "left", color: MIST }),
        rect({ name: "Code card", x: 45, y: 104, width: 120, height: 120, radius: 6, fill: CREAM }),
        qr({ x: 55, y: 114, width: 100, background: CREAM }),
        text({ text: "1   Open your phone's camera\n2   Point it at the code\n3   Add your photos", x: 45, y: 236, width: 120, size: 14, weight: 500, lineHeight: 1.55, align: "left", color: CREAM }),
        address({ x: 20, y: 280, width: 170, size: 10, color: ASH }),
      ]),
  },
  {
    key: "flyer-cream",
    name: "Flyer",
    blurb: "A5, cream on black. Hand them out or leave them on tables.",
    preset: "a5",
    build: (context) =>
      page(INK, [
        eventName(context, { x: 14, y: 16, width: 120, size: 12, minSize: 8, maxLines: 2, weight: 600, uppercase: true, tracking: 160, align: "left", color: ASH, lineHeight: 1.3 }),
        text({ text: "Share your photos", x: 14, y: 30, width: 120, size: 34, font: "fraunces", weight: 600, align: "left", lineHeight: 1.05, color: CREAM }),
        text({ text: "Scan the code with your phone's camera. No app, and no sign-up.", x: 14, y: 62, width: 120, size: 11, align: "left", lineHeight: 1.4, color: CREAM }),
        qr({ x: 34, y: 84, width: 80, background: CREAM }),
        address({ x: 14, y: 172, width: 120, size: 8.5, color: ASH }),
        text({ text: "Photos are shared with the guests of this event.", x: 14, y: 186, width: 120, size: 8, color: ASH }),
      ]),
  },
  {
    key: "table-card",
    name: "Table card",
    blurb: "4 × 6 in, ink on white. One for every table.",
    preset: "card-4x6",
    build: (context) =>
      page(WHITE, [
        eventName(context, { x: 8, y: 12, width: 85.6, size: 22, minSize: 13, maxLines: 2, font: "fraunces", weight: 600, color: INK }),
        text({ text: "Take photos. Share them here.", x: 8, y: 40, width: 85.6, size: 11, color: STONE }),
        qr({ x: 20.8, y: 54, width: 60 }),
        text({ text: "Scan with your camera", x: 8, y: 120, width: 85.6, size: 9, weight: 600, uppercase: true, tracking: 160 }),
        address({ x: 8, y: 132, width: 85.6, size: 7.5, color: STONE }),
      ]),
  },
  {
    key: "sticker-sheet",
    name: "Sticker sheet",
    blurb: "Twelve round stickers on an A4 sheet. For glasses, cameras and favours.",
    preset: "sticker-sheet",
    build: (context) => {
      const fill = onAccent(context.accent);
      const elements: PrintElement[] = [];
      for (const cy of [44, 111, 178, 245]) {
        for (const cx of [37, 105, 173]) {
          elements.push(
            ellipse({ name: "Sticker", x: cx - 29, y: cy - 29, width: 58, height: 58, fill }),
            qr({ x: cx - 16.5, y: cy - 22.5, width: 33, background: fill }),
            text({ text: "Scan for photos", x: cx - 20, y: cy + 12, width: 40, size: 7.5, weight: 700, uppercase: true, tracking: 100 }),
          );
        }
      }
      return page(WHITE, elements);
    },
  },
  {
    key: "welcome-sign",
    name: "Welcome sign",
    blurb: "18 × 24 in, ink on cream. On an easel at the door.",
    preset: "sign-18x24",
    build: (context) =>
      page(CREAM, [
        text({ text: "Welcome to", x: 40, y: 60, width: 377.2, size: 60, font: "fraunces", italic: true, color: INK }),
        eventName(context, { x: 30, y: 92, width: 397.2, size: 130, minSize: 70, maxLines: 2, font: "fraunces", weight: 600, color: INK }),
        ...(context.dateLabel
          ? [text({ name: "Date", text: context.dateLabel, x: 40, y: 200, width: 377.2, size: 26, weight: 500, uppercase: true, tracking: 200, color: STONE })]
          : []),
        line({ x: 178.6, y: 232, width: 100, strokeWidth: 0.8 }),
        text({ text: "Share your photos with us", x: 40, y: 254, width: 377.2, size: 36, weight: 600, color: INK }),
        qr({ x: 128.6, y: 290, width: 200 }),
        text({ text: "Open your phone's camera and point it at the code", x: 40, y: 512, width: 377.2, size: 24, color: STONE }),
        address({ x: 40, y: 548, width: 377.2, size: 18, color: STONE }),
      ]),
  },
  {
    key: "bar-sign",
    name: "Bar sign",
    blurb: "8 × 10 in on the accent colour. Propped up by the drinks.",
    preset: "sign-8x10",
    build: (context) => {
      const fill = onAccent(context.accent);
      return page(fill, [
        eventName(context, { x: 16, y: 18, width: 171.2, size: 12, minSize: 8, maxLines: 1, weight: 600, uppercase: true, tracking: 200, color: INK, lineHeight: 1.3 }),
        text({ text: "Raise a glass, then a camera", x: 16, y: 30, width: 171.2, size: 40, font: "fraunces", weight: 600, lineHeight: 1.05, color: INK }),
        icon({ icon: "sparkle", x: 172, y: 18, width: 12, color: INK }),
        qr({ x: 56.6, y: 92, width: 90, background: fill === CREAM ? CREAM : null }),
        text({ text: "Scan, snap, share. Your photos go straight to the gallery.", x: 21.6, y: 194, width: 160, size: 13, weight: 500, lineHeight: 1.35, color: INK }),
        address({ x: 16, y: 230, width: 171.2, size: 9, color: INK, opacity: 0.8 }),
      ]);
    },
  },
  {
    key: "menu-insert",
    name: "Menu insert",
    blurb: "4 × 9 in, ink on cream. Tucked into a menu or a napkin.",
    preset: "menu-4x9",
    build: (context) =>
      page(CREAM, [
        eventName(context, { x: 8, y: 16, width: 85.6, size: 20, minSize: 12, maxLines: 2, font: "fraunces", weight: 600, color: INK }),
        line({ x: 35.8, y: 46, width: 30, strokeWidth: 0.35 }),
        text({ text: "Between courses", x: 8, y: 54, width: 85.6, size: 9, weight: 500, uppercase: true, tracking: 160, color: STONE }),
        text({ text: "Take a photo of your table and add it to the gallery.", x: 10.8, y: 66, width: 80, size: 15, font: "fraunces", italic: true, lineHeight: 1.25, color: INK }),
        qr({ x: 20.8, y: 110, width: 60 }),
        text({ text: "Scan with your camera", x: 8, y: 176, width: 85.6, size: 8, weight: 600, uppercase: true, tracking: 160 }),
        address({ x: 8, y: 186, width: 85.6, size: 7, color: STONE }),
      ]),
  },
  {
    key: "place-card",
    name: "Place card",
    blurb: "3.5 × 2 in. A name on one side of the card, the code on the other.",
    preset: "place-card",
    build: (context) =>
      page(WHITE, [
        text({ name: "Guest name", text: "Guest name", x: 6, y: 10, width: 42, size: 18, font: "fraunces", weight: 500, align: "left", lineHeight: 1.1 }),
        eventName(context, { x: 6, y: 34, width: 42, size: 7, minSize: 6, maxLines: 2, weight: 500, uppercase: true, tracking: 120, align: "left", color: STONE, lineHeight: 1.3 }),
        qr({ x: 52, y: 8, width: 32 }),
        text({ text: "Scan for photos", x: 52, y: 41, width: 32, size: 6, weight: 600, uppercase: true, tracking: 80 }),
      ]),
  },
  {
    key: "thank-you",
    name: "Thank-you card",
    blurb: "5 × 7 in, cream on black. Sent after, with the gallery inside.",
    preset: "card-5x7",
    build: (context) =>
      page(INK, [
        text({ text: "Thank you", x: 10, y: 20, width: 107, size: 64, font: "greatvibes", lineHeight: 1.1, color: CREAM }),
        text({ text: "for celebrating with us", x: 10, y: 50, width: 107, size: 16, font: "fraunces", italic: true, color: CREAM }),
        eventName(context, { x: 10, y: 66, width: 107, size: 9, minSize: 7, maxLines: 2, weight: 600, uppercase: true, tracking: 200, color: onDark(context.accent), lineHeight: 1.3 }),
        qr({ x: 33.5, y: 84, width: 60, background: CREAM }),
        text({ text: "Relive the day: every photo is in the gallery.", x: 10, y: 152, width: 107, size: 10, color: MIST }),
        address({ x: 10, y: 163, width: 107, size: 7.5, color: ASH }),
      ]),
  },
  {
    key: "story",
    name: "Instagram story",
    blurb: "1080 × 1920 for a story or a status. Guests scan it off the screen.",
    preset: "story",
    build: (context) =>
      page(INK, [
        text({ text: "The photos are in", x: 8, y: 14, width: 74, size: 9, weight: 700, uppercase: true, tracking: 220, color: onDark(context.accent) }),
        eventName(context, { x: 8, y: 22, width: 74, size: 26, minSize: 14, maxLines: 3, font: "fraunces", weight: 600, color: CREAM }),
        rect({ name: "Code card", x: 17, y: 58, width: 56, height: 56, radius: 4, fill: CREAM }),
        qr({ x: 20, y: 61, width: 50, background: CREAM }),
        text({ text: "Scan it from another phone, or tap the link", x: 10, y: 122, width: 70, size: 9, lineHeight: 1.35, color: CREAM }),
        address({ x: 8, y: 140, width: 74, size: 7.5, color: ASH }),
      ]),
  },
  {
    key: "save-the-date",
    name: "Save the date",
    blurb: "5 × 7 in, ink on cream. The gallery is ready before the day is.",
    preset: "card-5x7",
    build: (context) =>
      page(CREAM, [
        text({ text: "Save the date", x: 10, y: 20, width: 107, size: 30, font: "fraunces", italic: true, color: INK }),
        text({ name: "Date", text: context.dateLabel ?? "Date to follow", x: 10, y: 40, width: 107, size: 11, weight: 600, uppercase: true, tracking: 160, lineHeight: 1.3, color: INK }),
        eventName(context, { x: 10, y: 58, width: 107, size: 22, minSize: 13, maxLines: 2, font: "fraunces", weight: 600, color: INK }),
        line({ x: 48.5, y: 92, width: 30, strokeWidth: 0.35 }),
        text({ text: "Scan to see the gallery, and add your photos on the day.", x: 13.5, y: 100, width: 100, size: 10, lineHeight: 1.35, color: STONE }),
        qr({ x: 36.5, y: 116, width: 54 }),
      ]),
  },
];

export function findTemplate(key: string): PrintTemplate | null {
  return PRINT_TEMPLATES.find((template) => template.key === key) ?? null;
}
