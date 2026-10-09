import QRCode from "qrcode";

/**
 * A QR code as shapes in module units, for every renderer: the server's SVG
 * (QR-2), which is decoded before it is served, and the print studio's canvas
 * (QR-4), which draws the same shapes at any size. One list, so a design never
 * prints a code drawn by rules the decode check did not see.
 *
 * Coordinates count modules from the outer edge of the quiet zone, so a code
 * of `count` modules spans `count + 2 * QR_QUIET_MODULES` units.
 */

export const QR_STYLES = ["classic", "dots", "rounded"] as const;
export type QrStyle = (typeof QR_STYLES)[number];

/** The quiet zone the standard asks for, on every side, always drawn. */
export const QR_QUIET_MODULES = 4;

export type QrShape =
  /** A filled square module, drawn a hair oversize so neighbours do not seam. */
  | { kind: "square"; x: number; y: number; size: number }
  | { kind: "dot"; cx: number; cy: number; r: number }
  | { kind: "rounded"; x: number; y: number; size: number; radius: number }
  /** A finder pattern's outer ring, drawn as a stroke. */
  | { kind: "ring"; x: number; y: number; size: number; radius: number; stroke: number };

export interface QrLayout {
  /** Modules across the code itself, without the quiet zone. */
  count: number;
  /** Units across the whole square, quiet zone included. */
  span: number;
  shapes: QrShape[];
}

/** Medium error correction, as the served code has always used. */
export function qrModuleCount(text: string): number {
  return QRCode.create(text, { errorCorrectionLevel: "M" }).modules.size;
}

export function qrLayout(text: string, style: QrStyle): QrLayout {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = QR_QUIET_MODULES;
  const modules = qr.modules as unknown as {
    get(row: number, column: number): number;
    isReserved(row: number, column: number): boolean;
  };
  const isFinder = (row: number, column: number) =>
    (row < 7 && column < 7) || (row < 7 && column >= count - 7) || (row >= count - 7 && column < 7);

  const shapes: QrShape[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!modules.get(row, column) || (style !== "classic" && isFinder(row, column))) continue;
      const x = column + quiet;
      const y = row + quiet;
      // The code's own structure (timing lines, alignment and format patterns)
      // stays square in every style. Styling those is what stopped dot and
      // rounded codes decoding when they were first built.
      if (modules.isReserved(row, column) || style === "classic") {
        shapes.push({ kind: "square", x, y, size: 1.04 });
      } else if (style === "dots") {
        shapes.push({ kind: "dot", cx: x + 0.5, cy: y + 0.5, r: 0.45 });
      } else {
        shapes.push({ kind: "rounded", x, y, size: 1.02, radius: 0.35 });
      }
    }
  }

  if (style !== "classic") {
    // Finder patterns: a 7x7 ring, a gap, and a 3x3 centre, as rounded squares.
    for (const [row, column] of [
      [0, 0],
      [0, count - 7],
      [count - 7, 0],
    ]) {
      const x = column + quiet;
      const y = row + quiet;
      shapes.push(
        { kind: "ring", x: x + 0.5, y: y + 0.5, size: 6, radius: 1.6, stroke: 1 },
        { kind: "rounded", x: x + 2, y: y + 2, size: 3, radius: 0.9 },
      );
    }
  }

  return { count, span: count + quiet * 2, shapes };
}
