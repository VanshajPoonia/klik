import type { PrintDoc, QrElement } from "./doc";
import { elementBox } from "./doc";
import { renderPage, type DrawEnv } from "./draw";
import { findPreset, type DesignSize } from "./presets";

/**
 * QR-4e: exporting a design, entirely in the browser that has its fonts.
 *
 * - **PNG** at 300 (or 150) pixels per inch, with that resolution written into
 *   the file, so a print shop opening it sees the physical size, not a guess.
 *   A digital design comes out at its exact pixel size instead.
 * - **PDF** at the page's physical size through pdf-lib, the page drawn as one
 *   high-resolution image. Optionally with the bleed and crop marks a printer
 *   cuts to, and with the trim and bleed boxes set so their software knows the
 *   finished size without being told.
 *
 * And the check no arithmetic can make: the rendered page is read back with a
 * QR decoder, so a code with a photo behind it or a shape across its corner is
 * caught before it is laminated onto forty tables.
 */

export const PRINT_DPIS = [300, 150] as const;
export type PrintDpi = (typeof PRINT_DPIS)[number];

const MM_PER_INCH = 25.4;
/** Crop marks sit in this margin outside the bleed. */
const MARK_AREA_MM = 10;
const MARK_LENGTH_MM = 5;
const MARK_GAP_MM = 1;

/** A phone's browser refuses canvases much past this; a computer's go further. */
function maxCanvasPixels(): number {
  const mobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return mobile ? 16_000_000 : 100_000_000;
}

/**
 * The resolution an export can actually be drawn at here: the one asked for,
 * or less when the page is so large that this device cannot hold the canvas.
 */
export function feasibleDpi(size: DesignSize, requested: number, includeBleed: boolean): number {
  const margin = includeBleed ? size.bleedMm : 0;
  const areaInches = ((size.widthMm + margin * 2) / MM_PER_INCH) * ((size.heightMm + margin * 2) / MM_PER_INCH);
  const limit = Math.floor(Math.sqrt(maxCanvasPixels() / areaInches));
  return Math.max(72, Math.min(requested, limit));
}

function canvasBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The design could not be drawn at this size."))), type, quality),
  );
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Writes a PNG's physical resolution (its `pHYs` chunk) right after the
 * header, which is where the format puts it. Without it a PNG says nothing
 * about how big it is meant to print.
 */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

export interface ExportOptions {
  dpi: number;
  /** PDF only: draw the bleed and crop marks around the page. */
  marks: boolean;
}

export async function exportPng(doc: PrintDoc, size: DesignSize, env: DrawEnv, dpi: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const pixels = findPreset(size.preset)?.pixels;
  if (pixels) {
    renderPage(canvas, doc, size, env, { pixelsPerMm: pixels.width / size.widthMm, includeBleed: false });
    return canvasBlob(canvas, "image/png");
  }
  renderPage(canvas, doc, size, env, { pixelsPerMm: dpi / MM_PER_INCH, includeBleed: false });
  const png = new Uint8Array(await (await canvasBlob(canvas, "image/png")).arrayBuffer());
  return new Blob([withPngDpi(png, dpi) as BlobPart], { type: "image/png" });
}

export async function exportPdf(
  doc: PrintDoc,
  size: DesignSize,
  env: DrawEnv,
  { dpi, marks }: ExportOptions,
  title: string,
): Promise<Blob> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const withBleed = marks && size.bleedMm > 0;
  const bleed = withBleed ? size.bleedMm : 0;
  const area = withBleed ? MARK_AREA_MM : 0;

  const canvas = document.createElement("canvas");
  renderPage(canvas, doc, size, env, { pixelsPerMm: dpi / MM_PER_INCH, includeBleed: withBleed });
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", 0.95)).arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;

  const pt = (mm: number) => (mm * 72) / MM_PER_INCH;
  const pageWidth = size.widthMm + bleed * 2 + area * 2;
  const pageHeight = size.heightMm + bleed * 2 + area * 2;
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Klik print studio");
  pdf.setProducer("Klik");
  const page = pdf.addPage([pt(pageWidth), pt(pageHeight)]);
  const image = await pdf.embedJpg(jpeg);
  page.drawImage(image, { x: pt(area), y: pt(area), width: pt(size.widthMm + bleed * 2), height: pt(size.heightMm + bleed * 2) });
  page.setBleedBox(pt(area), pt(area), pt(size.widthMm + bleed * 2), pt(size.heightMm + bleed * 2));
  page.setTrimBox(pt(area + bleed), pt(area + bleed), pt(size.widthMm), pt(size.heightMm));

  if (withBleed) {
    // Two short lines at each corner of the trim, outside the bleed, in
    // registration black: where the guillotine goes.
    const left = area + bleed;
    const bottom = area + bleed;
    const right = left + size.widthMm;
    const top = bottom + size.heightMm;
    const near = bleed + MARK_GAP_MM;
    const far = near + MARK_LENGTH_MM;
    const black = rgb(0, 0, 0);
    const lineAt = (x1: number, y1: number, x2: number, y2: number) =>
      page.drawLine({ start: { x: pt(x1), y: pt(y1) }, end: { x: pt(x2), y: pt(y2) }, thickness: 0.25, color: black });
    for (const x of [left, right]) {
      lineAt(x, bottom - near, x, bottom - far);
      lineAt(x, top + near, x, top + far);
    }
    for (const y of [bottom, top]) {
      lineAt(left - near, y, left - far, y);
      lineAt(right + near, y, right + far, y);
    }
  }

  // Without object streams: a plainer file that older print-shop software
  // reads without complaint, for a few bytes more.
  const bytes = await pdf.save({ useObjectStreams: false });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/**
 * Reads every QR code on the drawn page back with a decoder, the way a phone
 * would. Returns the ids of codes that did not read as the gallery's address.
 */
export async function unreadableCodes(doc: PrintDoc, size: DesignSize, env: DrawEnv): Promise<string[]> {
  const codes = doc.elements.filter((element): element is QrElement => element.type === "qr" && !element.hidden);
  if (codes.length === 0) return [];
  const { default: jsQR } = await import("jsqr");
  const pixelsPerMm = Math.min(8, Math.sqrt(30_000_000 / (size.widthMm * size.heightMm)));
  const page = document.createElement("canvas");
  renderPage(page, doc, size, env, { pixelsPerMm, includeBleed: false });

  const failed: string[] = [];
  for (const code of codes) {
    const box = elementBox(code);
    const pad = code.width * 0.08;
    const sx = Math.max(0, (box.left - pad) * pixelsPerMm);
    const sy = Math.max(0, (box.top - pad) * pixelsPerMm);
    const sw = Math.min(page.width - sx, (box.right - box.left + pad * 2) * pixelsPerMm);
    const sh = Math.min(page.height - sy, (box.bottom - box.top + pad * 2) * pixelsPerMm);
    if (sw <= 0 || sh <= 0) {
      failed.push(code.id);
      continue;
    }
    const side = 600;
    const crop = document.createElement("canvas");
    crop.width = side;
    crop.height = side;
    const context = crop.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    const scale = Math.min(side / sw, side / sh);
    context.drawImage(page, sx, sy, sw, sh, (side - sw * scale) / 2, (side - sh * scale) / 2, sw * scale, sh * scale);
    const { data } = context.getImageData(0, 0, side, side);
    const decoded = jsQR(data, side, side, { inversionAttempts: "dontInvert" });
    if (decoded?.data !== env.url) failed.push(code.id);
  }
  page.width = 0;
  page.height = 0;
  return failed;
}

/** A small JPEG of the page for the list of designs. */
export async function thumbnailBlob(doc: PrintDoc, size: DesignSize, env: DrawEnv, longest = 480): Promise<Blob> {
  const canvas = document.createElement("canvas");
  renderPage(canvas, doc, size, env, { pixelsPerMm: longest / Math.max(size.widthMm, size.heightMm), includeBleed: false });
  return canvasBlob(canvas, "image/jpeg", 0.82);
}

/** `klik-<slug>-<preset>.pdf`, as the roadmap names exports. */
export function exportFilename(slug: string, preset: string, extension: "pdf" | "png"): string {
  return `klik-${slug}-${preset}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
