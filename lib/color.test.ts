import { describe, expect, it } from "vitest";
import { contrastRatio, ensureContrast, galleryPalette, mixToward } from "./color";

describe("TRS-3 readable gallery colours", () => {
  const backgrounds = ["#050505", "#090a08", "#ffffff", "#f6f1e7", "#888888", "#7a7a7a", "#2f6fdc", "#d4af37", "#ff0000", "#00ff00"];
  const accents = ["#edee00", "#e8f000", "#ffffff", "#000000", "#2f6fdc", "#ff69b4", "#888888", "#123456"];

  it("holds every pairing a host can pick to WCAG AA", () => {
    for (const background of backgrounds) {
      for (const accent of accents) {
        const palette = galleryPalette(accent, background);
        const best = Math.max(contrastRatio("#000000", background), contrastRatio("#ffffff", background));
        expect(contrastRatio(palette.paper, background), `paper on ${background}`).toBeGreaterThanOrEqual(Math.min(7, best));
        expect(contrastRatio(palette.paper, background), `paper on ${background}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.muted, background), `muted on ${background}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.volt, background), `${accent} on ${background}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(palette.onVolt, palette.volt), `label on ${accent}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps a host's accent untouched wherever it already reads", () => {
    expect(galleryPalette("#edee00", "#090a08")).toMatchObject({ volt: "#edee00", accentAdjusted: false });
    const onWhite = galleryPalette("#edee00", "#ffffff");
    expect(onWhite.accentAdjusted).toBe(true);
    expect(onWhite.volt).not.toBe("#000000");
  });

  it("mixes and nudges as little as it needs", () => {
    expect(mixToward("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(ensureContrast("#777777", "#ffffff", 4.5)).not.toBe("#000000");
    expect(contrastRatio(ensureContrast("#777777", "#ffffff", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
