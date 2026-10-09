import { qrLayout, type QrLayout, type QrStyle } from "../qr-shapes";
import type { PrintDoc, PrintElement, TextElement } from "./doc";
import { MM_PER_POINT } from "./fonts";
import { ICON_BOX, PRINT_ICONS } from "./icons";
import type { DesignSize } from "./presets";

/**
 * QR-4b and QR-4e: how a design is drawn, once, for everything. The editor's
 * canvas calls `drawElement` from inside each element's shape, the list's
 * thumbnails and the export call `renderPage`, and both reach the same lines
 * here, so what is on screen is what prints.
 *
 * Plain Canvas 2D in millimetre units; the caller has already scaled the
 * context to pixels and moved it to the element's corner and angle. Browser
 * only: it needs a canvas to measure type.
 */

/** Everything drawing needs that is not in the design itself. */
export interface DrawEnv {
  /** The CSS family for a font key, as loaded on this page. */
  family: (key: string) => string;
  /** Images by asset id, decoded. Missing ones draw as a placeholder. */
  images: ReadonlyMap<string, CanvasImageSource & { width: number; height: number }>;
  eventName: string;
  /** The gallery address a QR code encodes. */
  url: string;
  /** In the editor, a missing image shows where it will go; in an export it never draws. */
  placeholders: boolean;
}

/**
 * Type is set at this many times its size and scaled back down, because some
 * browsers draw text badly at the fractions of a pixel a millimetre-scaled
 * canvas asks for.
 */
const TEXT_SCALE = 40;

const qrCache = new Map<string, QrLayout>();
function cachedQr(url: string, style: QrStyle): QrLayout {
  const key = `${style}|${url}`;
  let layout = qrCache.get(key);
  if (!layout) {
    layout = qrLayout(url, style);
    qrCache.set(key, layout);
  }
  return layout;
}

/** The address as a person writes it, without the scheme. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** What a text element says, after its binding and case. */
export function textContent(element: TextElement, env: Pick<DrawEnv, "eventName" | "url">): string {
  const raw = element.bind === "eventName" ? env.eventName : element.bind === "url" ? displayUrl(env.url) : element.text;
  return element.uppercase ? raw.toLocaleUpperCase() : raw;
}

function fontString(element: TextElement, family: string): string {
  const sizePx = element.size * MM_PER_POINT * TEXT_SCALE;
  return `${element.italic ? "italic " : ""}${element.weight} ${sizePx}px ${family}`;
}

let measuringContext: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measuringContext) measuringContext = document.createElement("canvas").getContext("2d")!;
  return measuringContext;
}

export interface TextLayout {
  lines: Array<{ text: string; width: number }>;
  lineHeightMm: number;
  heightMm: number;
}

/**
 * Wraps a text element to its width: on spaces, and through a word only when
 * one word is wider than the whole box. Widths are in millimetres and include
 * the element's tracking.
 */
export function layoutText(element: TextElement, env: Pick<DrawEnv, "family" | "eventName" | "url">, context = measurer()): TextLayout {
  context.save();
  context.font = fontString(element, env.family(element.font));
  const spacing = (element.tracking / 1000) * element.size * MM_PER_POINT;
  const measure = (value: string) => context.measureText(value).width / TEXT_SCALE + spacing * Math.max(0, [...value].length - 1);

  const lines: Array<{ text: string; width: number }> = [];
  for (const paragraph of textContent(element, env).split("\n")) {
    const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line.trim() === "" || measure(candidate.trimEnd()) <= element.width + 0.01) {
        line = candidate;
        continue;
      }
      lines.push({ text: line.trimEnd(), width: measure(line.trimEnd()) });
      line = /^\s+$/.test(word) ? "" : word;
      // A single word wider than the box is broken where it has to be.
      while (measure(line) > element.width && [...line].length > 1) {
        const characters = [...line];
        let fit = characters.length - 1;
        while (fit > 1 && measure(characters.slice(0, fit).join("")) > element.width) fit -= 1;
        lines.push({ text: characters.slice(0, fit).join(""), width: measure(characters.slice(0, fit).join("")) });
        line = characters.slice(fit).join("");
      }
    }
    lines.push({ text: line.trimEnd(), width: measure(line.trimEnd()) });
  }
  context.restore();

  const lineHeightMm = element.size * MM_PER_POINT * element.lineHeight;
  return { lines, lineHeightMm, heightMm: Math.max(lineHeightMm, lines.length * lineHeightMm) };
}

/** A rounded rectangle added to the current path, wherever it sits. */
function roundedSubpath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function roundedRectPath(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(r, 0);
  context.arcTo(width, 0, width, height, r);
  context.arcTo(width, height, 0, height, r);
  context.arcTo(0, height, 0, 0, r);
  context.arcTo(0, 0, width, 0, r);
  context.closePath();
}

/** Draws `image` to fill, or fit inside, a `width` by `height` box at the origin. */
function drawFitted(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number,
  fit: "cover" | "contain",
) {
  const scale =
    fit === "cover" ? Math.max(width / image.width, height / image.height) : Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  context.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function drawPlaceholder(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = "#d9d7cf";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#8c8a80";
  context.lineWidth = Math.min(width, height) * 0.01;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, height);
  context.moveTo(width, 0);
  context.lineTo(0, height);
  context.stroke();
}

function drawText(context: CanvasRenderingContext2D, element: TextElement, env: DrawEnv) {
  const layout = layoutText(element, env, context);
  const spacing = (element.tracking / 1000) * element.size * MM_PER_POINT;
  context.save();
  context.font = fontString(element, env.family(element.font));
  context.fillStyle = element.color;
  context.textBaseline = "middle";
  layout.lines.forEach((line, index) => {
    const left =
      element.align === "center" ? (element.width - line.width) / 2 : element.align === "right" ? element.width - line.width : 0;
    const middle = index * layout.lineHeightMm + layout.lineHeightMm / 2;
    context.save();
    context.translate(left, middle);
    context.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
    if (spacing === 0) {
      context.fillText(line.text, 0, 0);
    } else {
      // Tracking by hand: `letterSpacing` on a canvas is too new to rely on.
      let x = 0;
      for (const character of line.text) {
        context.fillText(character, x, 0);
        x += context.measureText(character).width + spacing * TEXT_SCALE;
      }
    }
    context.restore();
  });
  context.restore();
}

/**
 * One element, at the origin, in its own millimetres. Position, rotation and
 * opacity are the caller's: the editor's shapes and `renderPage` apply them.
 */
export function drawElement(context: CanvasRenderingContext2D, element: PrintElement, env: DrawEnv) {
  switch (element.type) {
    case "qr": {
      const layout = cachedQr(env.url, element.style);
      const cell = element.width / layout.span;
      if (element.background) {
        context.fillStyle = element.background;
        context.fillRect(0, 0, element.width, element.width);
      }
      // Every module goes into one path, filled once. Filled one by one, the
      // edges two modules share are each half-covered and blended twice,
      // which leaves faint seams through the dark areas, on screen and in print.
      context.fillStyle = element.foreground;
      context.strokeStyle = element.foreground;
      context.beginPath();
      for (const shape of layout.shapes) {
        if (shape.kind === "square") {
          context.rect(shape.x * cell, shape.y * cell, shape.size * cell, shape.size * cell);
        } else if (shape.kind === "dot") {
          context.moveTo((shape.cx + shape.r) * cell, shape.cy * cell);
          context.arc(shape.cx * cell, shape.cy * cell, shape.r * cell, 0, Math.PI * 2);
        } else if (shape.kind === "rounded") {
          roundedSubpath(context, shape.x * cell, shape.y * cell, shape.size * cell, shape.size * cell, shape.radius * cell);
        }
      }
      context.fill();
      for (const shape of layout.shapes) {
        if (shape.kind !== "ring") continue;
        context.beginPath();
        roundedSubpath(context, shape.x * cell, shape.y * cell, shape.size * cell, shape.size * cell, shape.radius * cell);
        context.lineWidth = shape.stroke * cell;
        context.stroke();
      }
      return;
    }
    case "text":
      drawText(context, element, env);
      return;
    case "image": {
      const image = env.images.get(element.assetId);
      context.save();
      roundedRectPath(context, element.width, element.height, element.radius);
      context.clip();
      if (image) drawFitted(context, image, element.width, element.height, element.fit);
      else if (env.placeholders) drawPlaceholder(context, element.width, element.height);
      context.restore();
      return;
    }
    case "rect":
      roundedRectPath(context, element.width, element.height, element.radius);
      if (element.fill) {
        context.fillStyle = element.fill;
        context.fill();
      }
      if (element.stroke && element.strokeWidth > 0) {
        context.strokeStyle = element.stroke;
        context.lineWidth = element.strokeWidth;
        context.stroke();
      }
      return;
    case "ellipse":
      context.beginPath();
      context.ellipse(element.width / 2, element.height / 2, element.width / 2, element.height / 2, 0, 0, Math.PI * 2);
      if (element.fill) {
        context.fillStyle = element.fill;
        context.fill();
      }
      if (element.stroke && element.strokeWidth > 0) {
        context.strokeStyle = element.stroke;
        context.lineWidth = element.strokeWidth;
        context.stroke();
      }
      return;
    case "line":
      context.beginPath();
      context.moveTo(0, element.height / 2);
      context.lineTo(element.width, element.height / 2);
      context.strokeStyle = element.stroke;
      context.lineWidth = element.strokeWidth;
      context.lineCap = "butt";
      context.setLineDash(element.dashed ? [element.strokeWidth * 3, element.strokeWidth * 2] : []);
      context.stroke();
      context.setLineDash([]);
      return;
    case "icon": {
      context.save();
      context.scale(element.width / ICON_BOX, element.height / ICON_BOX);
      context.fillStyle = element.color;
      context.fill(new Path2D(PRINT_ICONS[element.icon].path));
      context.restore();
      return;
    }
  }
}

/** The page's background colour and photo, across the trim and the bleed. */
export function drawBackground(context: CanvasRenderingContext2D, doc: PrintDoc, size: DesignSize, env: DrawEnv) {
  const width = size.widthMm + size.bleedMm * 2;
  const height = size.heightMm + size.bleedMm * 2;
  context.save();
  context.translate(-size.bleedMm, -size.bleedMm);
  context.fillStyle = doc.background.color;
  context.fillRect(0, 0, width, height);
  if (doc.background.assetId) {
    const image = env.images.get(doc.background.assetId);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    if (image) drawFitted(context, image, width, height, "cover");
    else if (env.placeholders) drawPlaceholder(context, width, height);
    context.restore();
  }
  context.restore();
}

/**
 * The whole page onto a canvas, at `pixelsPerMm`, with or without its bleed.
 * The canvas is sized here. Hidden elements are left out, as they are in print.
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  doc: PrintDoc,
  size: DesignSize,
  env: DrawEnv,
  { pixelsPerMm, includeBleed }: { pixelsPerMm: number; includeBleed: boolean },
): void {
  const margin = includeBleed ? size.bleedMm : 0;
  canvas.width = Math.round((size.widthMm + margin * 2) * pixelsPerMm);
  canvas.height = Math.round((size.heightMm + margin * 2) * pixelsPerMm);
  const context = canvas.getContext("2d")!;
  context.save();
  context.scale(canvas.width / (size.widthMm + margin * 2), canvas.height / (size.heightMm + margin * 2));
  context.translate(margin, margin);
  drawBackground(context, doc, size, env);
  for (const element of doc.elements) {
    if (element.hidden) continue;
    context.save();
    context.translate(element.x, element.y);
    context.rotate((element.rotation * Math.PI) / 180);
    context.globalAlpha = element.opacity;
    drawElement(context, element, env);
    context.restore();
  }
  context.restore();
}
