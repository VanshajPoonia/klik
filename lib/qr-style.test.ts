import { describe, expect, it } from "vitest";
import { QR_STYLES, safeColors, styledQrSvg, verifyScannable } from "./qr-style";
import { contrastRatio } from "./color";

const url = "https://klik.kreativvantage.com/e/anna-and-leo-k3m9dx";

describe("styled QR codes", () => {
  /**
   * The whole point of QR-2's guard: every style this ships must actually
   * scan. Decoded by jsQR, the way a phone camera reads it.
   */
  it.each(QR_STYLES)("%s scans back to exactly the address it encodes", async (style) => {
    const svg = styledQrSvg({ text: url, style, foreground: "#050505", background: "#f3f1e9", size: 600 });
    expect(await verifyScannable(svg, url)).toBe(true);
  });

  it("still scans in a brand color with enough contrast", async () => {
    const svg = styledQrSvg({ text: url, style: "dots", foreground: "#1b3a5c", background: "#ffffff", size: 600 });
    expect(await verifyScannable(svg, url)).toBe(true);
  });

  it("refuses colors a camera cannot read and falls back to dark on white", () => {
    expect(safeColors("#edee00", "#ffffff")).toEqual({ foreground: "#050505", background: "#ffffff" });
    // Light on dark is refused even with contrast: many scanners will not read it.
    expect(safeColors("#ffffff", "#050505")).toEqual({ foreground: "#050505", background: "#ffffff" });
  });

  it("does not report a code as scannable when it encodes something else", async () => {
    const svg = styledQrSvg({ text: url, style: "classic", foreground: "#000000", background: "#ffffff", size: 600 });
    expect(await verifyScannable(svg, `${url}x`)).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});
