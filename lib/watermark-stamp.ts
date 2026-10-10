import { cssFont } from "./qr-compose";
import { stampPlacement } from "./watermark-layout";
import type { WatermarkPosition } from "./schema";

/**
 * MED-10, in the browser: a photographer's words and logo drawn into the
 * transparent PNG the server lays over their proofs. Drawn here because the
 * fonts are here; the server only ever composites an image.
 */

const STAMP_MAX_WIDTH = 1600;
const PADDING = 40;

export type StampFont = "sans" | "serif";

function family(font: StampFont) {
  return font === "serif" ? cssFont("--font-fraunces", "Georgia, serif") : cssFont("--font-geist-sans", "system-ui, sans-serif");
}

/** Waits for the typeface, so the first stamp is not drawn in a fallback. */
export async function stampFontReady(font: StampFont) {
  try {
    await document.fonts.load(`600 100px ${family(font)}`);
  } catch {
    // Drawn in the fallback instead.
  }
}

export function drawStamp({
  label,
  logo,
  font,
}: {
  label: string;
  logo: { image: CanvasImageSource; width: number; height: number } | null;
  font: StampFont;
}): HTMLCanvasElement {
  const text = label.trim();
  const face = family(font);
  const measure = document.createElement("canvas").getContext("2d")!;
  const maxContent = STAMP_MAX_WIDTH - PADDING * 2;

  let size = 150;
  measure.font = `600 ${size}px ${face}`;
  let textWidth = text ? measure.measureText(text).width : 0;
  if (textWidth > maxContent) {
    size = Math.max(24, Math.floor((size * maxContent) / textWidth));
    measure.font = `600 ${size}px ${face}`;
    textWidth = measure.measureText(text).width;
  }
  const textHeight = text ? Math.round(size * 1.3) : 0;

  let logoWidth = 0;
  let logoHeight = 0;
  if (logo) {
    const ratio = Math.min(maxContent / logo.width, 420 / logo.height);
    logoWidth = Math.round(logo.width * ratio);
    logoHeight = Math.round(logo.height * ratio);
  }
  const gap = logo && text ? Math.round(size * 0.35) : 0;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(40, Math.ceil(Math.max(textWidth, logoWidth) + PADDING * 2));
  canvas.height = Math.max(20, Math.ceil(logoHeight + gap + textHeight + PADDING * 2));
  const context = canvas.getContext("2d")!;
  // A soft shadow, so white reads on a bright sky and a dark logo on a dark suit.
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = Math.max(6, size * 0.12);
  context.shadowOffsetY = Math.max(1, size * 0.03);
  if (logo) {
    context.drawImage(logo.image, (canvas.width - logoWidth) / 2, PADDING, logoWidth, logoHeight);
  }
  if (text) {
    context.font = `600 ${size}px ${face}`;
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(text, canvas.width / 2, PADDING + logoHeight + gap + size);
  }
  return canvas;
}

/** Draws a stamp over a photo the way the server will, for the preview. */
export function paintStamp(
  context: CanvasRenderingContext2D,
  photo: { width: number; height: number },
  stamp: HTMLCanvasElement,
  settings: { position: WatermarkPosition; opacity: number; scale: number },
) {
  const placement = stampPlacement(photo, stamp, settings.position, settings.scale);
  context.save();
  context.globalAlpha = settings.opacity;
  if (placement.tile) {
    const stepX = placement.width + placement.gapX;
    const stepY = placement.height + placement.gapY;
    for (let y = Math.round(placement.gapY / 2); y < photo.height; y += stepY) {
      for (let x = Math.round(placement.gapX / 2); x < photo.width; x += stepX) {
        context.drawImage(stamp, x, y, placement.width, placement.height);
      }
    }
  } else {
    context.drawImage(stamp, placement.left, placement.top, placement.width, placement.height);
  }
  context.restore();
}

/** A logo picked from the device, shrunk to what the server keeps, as a PNG. */
export async function shrinkLogo(file: File, maxSide = 800): Promise<{ blob: Blob; image: HTMLImageElement } | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return { blob, image: await loadImage(URL.createObjectURL(blob)) };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded"));
    image.src = url;
  });
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
