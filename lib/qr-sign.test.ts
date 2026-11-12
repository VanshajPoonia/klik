import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./color";
import { GALLERY_TEMPLATES, templateByKey } from "./gallery-templates";
import { QR_STYLES } from "./qr-shapes";
import { styledQrSvg, verifyScannable } from "./qr-style";
import {
  GALLERY_COLORWAY,
  SIGN_HEADLINE_MAX,
  cleanSignOptions,
  paperByKey,
  printedAddress,
  signBaseColors,
  signDefaults,
  signHeadline,
  signPalette,
  signTitleSize,
  type SignCaps,
} from "./qr-sign";

const url = "https://klik.kreativvantage.com/e/anna-and-leo-k3m9dx";
const free: SignCaps = { qrStyles: false, hideLogo: false, galleryColors: false };
const premium: SignCaps = { qrStyles: true, hideLogo: true, galleryColors: true };

const everyColorway = GALLERY_TEMPLATES.flatMap((look) =>
  look.colorways.map((colorway) => ({ look, colorway, name: `${look.key} / ${colorway.key}` })),
);

describe("the sign's colours", () => {
  /**
   * The sign is drawn in the look's own colours, and so is its code. Every
   * colourway, on its own paper and printed on white, must give a code a phone
   * can read: dark on light, at least 4.5:1, and kept rather than replaced by
   * the black-on-white fallback (which would mean the look was never applied).
   */
  it.each(everyColorway)("$name draws its code in its own colours, dark on light", ({ colorway }) => {
    for (const saveInk of [false, true]) {
      const palette = signPalette({ accent: colorway.accent, background: colorway.background }, saveInk);
      expect(contrastRatio(palette.qrInk, palette.qrCard)).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(palette.qrInk)).toBeLessThan(relativeLuminance(palette.qrCard));
      expect(contrastRatio(palette.ink, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accent, palette.background)).toBeGreaterThanOrEqual(3);
      expect(palette.qrInk === "#050505" && palette.qrCard === "#ffffff").toBe(false);
    }
  });

  it.each(everyColorway)("$name scans in every style", async ({ colorway }) => {
    for (const saveInk of [false, true]) {
      const palette = signPalette({ accent: colorway.accent, background: colorway.background }, saveInk);
      for (const style of QR_STYLES) {
        const svg = styledQrSvg({ text: url, style, foreground: palette.qrInk, background: palette.qrCard, size: 600 });
        expect(await verifyScannable(svg, url), `${style}, save ink ${saveInk}`).toBe(true);
      }
    }
  });

  it("prints a dark look on white when asked to save ink, and leaves a light look alone", () => {
    expect(signPalette({ accent: "#d9bd8b", background: "#0c0b0a" }, true).background).toBe("#ffffff");
    expect(signPalette({ accent: "#8b6b3d", background: "#fffdf9" }, true).background).toBe("#fffdf9");
  });

  it("falls back to a code a phone can read when a host's own colours cannot carry one", () => {
    // Premium colours that pass for a gallery and fail for a code.
    const palette = signPalette({ accent: "#ffee00", background: "#808080" }, false);
    expect(contrastRatio(palette.qrInk, palette.qrCard)).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(palette.qrInk)).toBeLessThan(relativeLuminance(palette.qrCard));
  });

  it("uses the event's own colours only for the gallery choice", () => {
    const look = templateByKey("black-tie")!;
    const mine = { accent: "#123456", background: "#fedcba" };
    expect(signBaseColors(look, GALLERY_COLORWAY, mine)).toEqual(mine);
    expect(signBaseColors(look, "midnight", mine)).toEqual({ accent: "#e6cf9f", background: "#0f1420" });
    expect(signBaseColors(look, "not-a-colourway", mine)).toEqual({ accent: "#d9bd8b", background: "#0c0b0a" });
  });
});

describe("sign options", () => {
  const base = { look: "white-lace" as const, colorway: "sage", language: "en" as const, hasDate: true, hasMessage: false };

  it("start from the gallery's look and colours", () => {
    const options = signDefaults({ ...base, caps: free });
    expect(options).toMatchObject({ look: "white-lace", colorway: "sage", qrStyle: "classic", showLogo: true, showDate: true, showMessage: false });
  });

  it("start from the host's own colours on a plan that sets them", () => {
    expect(signDefaults({ ...base, colorway: null, caps: premium }).colorway).toBe(GALLERY_COLORWAY);
    expect(signDefaults({ ...base, colorway: null, caps: free }).colorway).toBe("white");
  });

  it("are held to what the plan allows, whatever was saved", () => {
    const defaults = signDefaults({ ...base, caps: free });
    const saved = { qrStyle: "dots", showLogo: false, colorway: GALLERY_COLORWAY, look: "white-lace" };
    expect(cleanSignOptions(saved, defaults, free)).toMatchObject({ qrStyle: "classic", showLogo: true, colorway: "white" });
    expect(cleanSignOptions(saved, defaults, premium)).toMatchObject({ qrStyle: "dots", showLogo: false, colorway: GALLERY_COLORWAY });
  });

  it("survive anything that is not a saved sign", () => {
    const defaults = signDefaults({ ...base, caps: free });
    for (const junk of [null, undefined, 42, "sign", [], { look: "neon", paper: "a0", perPage: 9, language: "fr" }]) {
      expect(cleanSignOptions(junk, defaults, free)).toEqual({ ...defaults, look: "white-lace" });
    }
  });

  it("drop a colourway from another look, and four to a page on small paper", () => {
    const defaults = signDefaults({ ...base, caps: free });
    const cleaned = cleanSignOptions({ look: "party", colorway: "sage", paper: "4x6", perPage: 4 }, defaults, free);
    expect(cleaned).toMatchObject({ look: "party", colorway: "confetti", paper: "4x6", perPage: 1 });
    expect(cleanSignOptions({ paper: "a4", perPage: 4 }, defaults, free).perPage).toBe(4);
  });

  it("cap the words a host types", () => {
    const defaults = signDefaults({ ...base, caps: free });
    expect(cleanSignOptions({ headline: "x".repeat(500) }, defaults, free).headline).toHaveLength(SIGN_HEADLINE_MAX);
  });

  it("say something over the code even when the host leaves it empty", () => {
    expect(signHeadline({ headline: "  ", language: "en" })).toBe("Scan to share your photos");
    expect(signHeadline({ headline: "", language: "es" })).toBe("Escanea y comparte tus fotos");
    expect(signHeadline({ headline: "Hola", language: "en" })).toBe("Hola");
  });
});

describe("the sign's layout", () => {
  it("knows its papers, and falls back to A4", () => {
    expect(paperByKey("letter").widthMm).toBeCloseTo(215.9);
    expect(paperByKey("nonsense").key).toBe("a4");
  });

  it("prints the address without its scheme", () => {
    expect(printedAddress(url)).toBe("klik.kreativvantage.com/e/anna-and-leo-k3m9dx");
  });

  it("sets a long title smaller than a short one, within each face's range", () => {
    for (const look of GALLERY_TEMPLATES) {
      const short = signTitleSize("Ana & Bo", look.key);
      const long = signTitleSize("The Okafor and Fitzgerald-Hernandez family reunion weekend", look.key);
      expect(long).toBeLessThan(short);
      expect(long).toBeGreaterThan(3);
    }
  });
});
