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
 *
 * The drawing itself is in `lib/qr-svg.ts`, which the browser can load too.
 */

export { QR_STYLES, type QrStyle } from "./qr-shapes";
export { MIN_QR_CONTRAST, safeColors, styledQrSvg, type StyledQrOptions } from "./qr-svg";

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
