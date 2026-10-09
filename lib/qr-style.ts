import { contrastRatio, relativeLuminance } from "./color";
import { qrLayout, type QrStyle } from "./qr-shapes";

/**
 * QR-2: styled QR codes, drawn as SVG from the code's own module matrix.
 *
 * Three styles. "classic" is square modules and is the default and the
 * fallback. "dots" and "rounded" soften the modules and draw the three finder
 * patterns as rounded squares, which is what makes a code look designed rather
 * than generated.
 *
 * **Every styled code is decoded before it is served** (`verifyScannable`), and
 * one that does not decode is replaced by the classic code. A pretty QR that
 * does not scan is worse than an ugly one that does, and with custom colors
 * that failure is common. Colors that fail the contrast a phone camera needs
 * are refused outright for the same reason.
 */

export { QR_STYLES, type QrStyle } from "./qr-shapes";

/** Below this a phone camera struggles, whatever the style. WCAG's 4.5:1. */
export const MIN_QR_CONTRAST = 4.5;

export interface StyledQrOptions {
  text: string;
  style: QrStyle;
  foreground: string;
  background: string;
  /** Total width in pixels, quiet zone included. */
  size: number;
}

/** Colors a phone can read, or the safe pair. Dark on light only: inverted
 *  codes are refused by a surprising number of scanners. */
export function safeColors(foreground: string, background: string): { foreground: string; background: string } {
  const fine =
    contrastRatio(foreground, background) >= MIN_QR_CONTRAST &&
    relativeLuminance(foreground) < relativeLuminance(background);
  return fine ? { foreground, background } : { foreground: "#050505", background: "#ffffff" };
}

export function styledQrSvg({ text, style, foreground, background, size }: StyledQrOptions): string {
  const colors = safeColors(foreground, background);
  const { span, shapes } = qrLayout(text, style);
  const cell = size / span;
  const n = (value: number) => (value * cell).toFixed(2);

  const drawn = shapes.map((shape) => {
    switch (shape.kind) {
      case "square":
        return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.size)}" height="${n(shape.size)}"/>`;
      case "dot":
        return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}"/>`;
      case "rounded":
        return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.size)}" height="${n(shape.size)}" rx="${n(shape.radius)}"/>`;
      case "ring":
        return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.size)}" height="${n(shape.size)}" rx="${n(shape.radius)}" fill="none" stroke="${colors.foreground}" stroke-width="${n(shape.stroke)}"/>`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${colors.background}"/><g fill="${colors.foreground}">${drawn.join("")}</g></svg>`;
}

/**
 * Renders the SVG and decodes it, the way a phone would. True only when the
 * decoded text is exactly what was encoded. Server-only: it needs sharp.
 */
export async function verifyScannable(svg: string, expected: string): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default;
    const jsQR = (await import("jsqr")).default;
    const { data, info } = await sharp(Buffer.from(svg))
      .resize(600, 600)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    return decoded?.data === expected;
  } catch {
    return false;
  }
}
