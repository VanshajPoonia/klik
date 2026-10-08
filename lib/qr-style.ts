import QRCode from "qrcode";
import { contrastRatio, relativeLuminance } from "./color";

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

export const QR_STYLES = ["classic", "dots", "rounded"] as const;
export type QrStyle = (typeof QR_STYLES)[number];

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
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = 4;
  const cell = size / (count + quiet * 2);
  const at = (index: number) => (index + quiet) * cell;
  const isFinder = (row: number, column: number) =>
    (row < 7 && column < 7) || (row < 7 && column >= count - 7) || (row >= count - 7 && column < 7);
  // The code's own structure (timing lines, alignment and format patterns)
  // stays square in every style. Styling those is what stopped dot and rounded
  // codes decoding when this was first built; styling only the data modules
  // decodes cleanly at every size tested.
  const modules = qr.modules as unknown as { get(row: number, column: number): number; isReserved(row: number, column: number): boolean };

  const shapes: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!modules.get(row, column) || (style !== "classic" && isFinder(row, column))) continue;
      const x = at(column);
      const y = at(row);
      if (modules.isReserved(row, column)) {
        shapes.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}"/>`);
      } else if (style === "dots") {
        shapes.push(`<circle cx="${(x + cell / 2).toFixed(2)}" cy="${(y + cell / 2).toFixed(2)}" r="${(cell * 0.45).toFixed(2)}"/>`);
      } else if (style === "rounded") {
        shapes.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cell + 0.3).toFixed(2)}" height="${(cell + 0.3).toFixed(2)}" rx="${(cell * 0.35).toFixed(2)}"/>`);
      } else {
        shapes.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}"/>`);
      }
    }
  }

  if (style !== "classic") {
    // Finder patterns: a 7x7 ring, a white gap, and a 3x3 centre, as rounded squares.
    for (const [row, column] of [[0, 0], [0, count - 7], [count - 7, 0]]) {
      const x = at(column);
      const y = at(row);
      shapes.push(
        `<rect x="${(x + cell / 2).toFixed(2)}" y="${(y + cell / 2).toFixed(2)}" width="${(cell * 6).toFixed(2)}" height="${(cell * 6).toFixed(2)}" rx="${(cell * 1.6).toFixed(2)}" fill="none" stroke="${colors.foreground}" stroke-width="${cell.toFixed(2)}"/>`,
        `<rect x="${(x + cell * 2).toFixed(2)}" y="${(y + cell * 2).toFixed(2)}" width="${(cell * 3).toFixed(2)}" height="${(cell * 3).toFixed(2)}" rx="${(cell * 0.9).toFixed(2)}"/>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${colors.background}"/><g fill="${colors.foreground}">${shapes.join("")}</g></svg>`;
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
