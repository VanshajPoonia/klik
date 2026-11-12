import { contrastRatio, relativeLuminance } from "./color";
import { qrLayout, type QrStyle } from "./qr-shapes";

/**
 * QR-2: a styled QR code as SVG markup, drawn from the code's own module
 * matrix. Safe in the browser as well as on the server: the decode check that
 * needs sharp lives in `lib/qr-style.ts`, so the printable sign can draw the
 * very same markup in the page and check it there.
 */

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
