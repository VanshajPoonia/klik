import { z } from "zod";
import { QR_STYLES } from "../qr-shapes";
import { PRINT_FONT_KEYS } from "./fonts";
import { PRINT_ICON_KEYS } from "./icons";

/**
 * QR-4a: a print design, as the studio edits it and the database stores it.
 *
 * A scene of elements over a background, every length in millimetres from the
 * top-left corner of the trimmed page. An element turns about its own top-left
 * corner, which is how the canvas library turns things, so the stored numbers
 * are exactly what is drawn.
 *
 * `schemaVersion` is what lets an old design survive the editor changing:
 * `upgradeDoc` brings any earlier version up to this one, and nothing else in
 * the studio ever sees an old shape.
 *
 * Client-safe: no database, no environment. The same schema checks a save on
 * the server and a template in a test.
 */

export const PRINT_SCHEMA_VERSION = 1;

export const MAX_ELEMENTS = 200;
export const MAX_TEXT_LENGTH = 600;
/** The largest stored design. A scene of 200 elements is far below it. */
export const MAX_DOC_BYTES = 256 * 1024;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const mm = z.number().finite().min(-2000).max(2000);
const length = z.number().finite().min(0.1).max(2000);

const base = {
  id: z.string().min(1).max(40),
  name: z.string().max(60).optional(),
  x: mm,
  y: mm,
  width: length,
  height: length,
  /** Degrees, clockwise, about the element's top-left corner. */
  rotation: z.number().finite().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

export const qrElementSchema = z.object({
  ...base,
  type: z.literal("qr"),
  style: z.enum(QR_STYLES),
  foreground: hex,
  /** Null draws no square behind the code, so whatever is beneath shows. */
  background: hex.nullable(),
});

export const textElementSchema = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(MAX_TEXT_LENGTH),
  /**
   * Text that follows the event: its name, or its gallery address, which
   * changes if the address does. Null is ordinary text.
   */
  bind: z.enum(["eventName", "url"]).nullable().default(null),
  font: z.enum(PRINT_FONT_KEYS),
  /** Points, as type is sized for print. */
  size: z.number().min(2).max(800),
  weight: z.number().int().min(100).max(900),
  italic: z.boolean().default(false),
  uppercase: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]),
  /** A multiple of the size. */
  lineHeight: z.number().min(0.6).max(3),
  /** Thousandths of the size, as letter-spacing is set in print. */
  tracking: z.number().min(-200).max(1000).default(0),
  color: hex,
});

export const imageElementSchema = z.object({
  ...base,
  type: z.literal("image"),
  assetId: z.string().min(1).max(40),
  fit: z.enum(["cover", "contain"]),
  radius: z.number().min(0).max(1000).default(0),
});

export const rectElementSchema = z.object({
  ...base,
  type: z.literal("rect"),
  fill: hex.nullable(),
  stroke: hex.nullable(),
  strokeWidth: z.number().min(0).max(100).default(0),
  radius: z.number().min(0).max(1000).default(0),
});

export const ellipseElementSchema = z.object({
  ...base,
  type: z.literal("ellipse"),
  fill: hex.nullable(),
  stroke: hex.nullable(),
  strokeWidth: z.number().min(0).max(100).default(0),
});

/** A straight line across its own width; height is only where it can be grabbed. */
export const lineElementSchema = z.object({
  ...base,
  type: z.literal("line"),
  stroke: hex,
  strokeWidth: z.number().min(0.05).max(100),
  dashed: z.boolean().default(false),
});

export const iconElementSchema = z.object({
  ...base,
  type: z.literal("icon"),
  icon: z.enum(PRINT_ICON_KEYS),
  color: hex,
});

export const elementSchema = z.discriminatedUnion("type", [
  qrElementSchema,
  textElementSchema,
  imageElementSchema,
  rectElementSchema,
  ellipseElementSchema,
  lineElementSchema,
  iconElementSchema,
]);

export const docSchema = z.object({
  schemaVersion: z.literal(PRINT_SCHEMA_VERSION),
  background: z.object({
    color: hex,
    /** A photo filling the page out to the bleed. */
    assetId: z.string().min(1).max(40).nullable().default(null),
  }),
  elements: z.array(elementSchema).max(MAX_ELEMENTS),
  /** Guides dragged out of the rulers, in millimetres from the trim. */
  guides: z
    .object({ x: z.array(mm).max(40).default([]), y: z.array(mm).max(40).default([]) })
    .default({ x: [], y: [] }),
});

export type PrintDoc = z.infer<typeof docSchema>;
export type PrintElement = z.infer<typeof elementSchema>;
export type QrElement = z.infer<typeof qrElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type ElementType = PrintElement["type"];

/**
 * Any stored design, brought up to the current schema, or null when it cannot
 * be read at all. Version 1 is the first, so this only checks it today; the
 * next change to the shape adds a step here rather than breaking old designs.
 */
export function upgradeDoc(raw: unknown): PrintDoc | null {
  const parsed = docSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Every image a design draws, the background's included. */
export function docAssetIds(doc: PrintDoc): string[] {
  const ids = new Set<string>();
  if (doc.background.assetId) ids.add(doc.background.assetId);
  for (const element of doc.elements) if (element.type === "image") ids.add(element.assetId);
  return [...ids];
}

let sequence = 0;

/** A short id, unique within a design, without a dependency on the clock alone. */
export function elementId(): string {
  sequence = (sequence + 1) % 1_000_000;
  return `el_${Date.now().toString(36)}${sequence.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyDoc(color = "#ffffff"): PrintDoc {
  return { schemaVersion: PRINT_SCHEMA_VERSION, background: { color, assetId: null }, elements: [], guides: { x: [], y: [] } };
}

/** The four corners of an element as drawn, after its rotation. */
export function elementCorners(element: Pick<PrintElement, "x" | "y" | "width" | "height" | "rotation">): Array<[number, number]> {
  const angle = (element.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (dx: number, dy: number): [number, number] => [element.x + dx * cos - dy * sin, element.y + dx * sin + dy * cos];
  return [at(0, 0), at(element.width, 0), at(element.width, element.height), at(0, element.height)];
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The upright box an element covers, after its rotation. */
export function elementBox(element: Pick<PrintElement, "x" | "y" | "width" | "height" | "rotation">): Box {
  const corners = elementCorners(element);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}
