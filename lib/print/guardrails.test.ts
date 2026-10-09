import { describe, expect, it } from "vitest";
import { emptyDoc, type PrintDoc, type PrintElement } from "./doc";
import { checkDesign, imageDpi, printsDuller, qrCodeMm } from "./guardrails";

const A5 = { preset: "a5", widthMm: 148, heightMm: 210, bleedMm: 3, digital: false };
const MODULES = 33;

const qr = (overrides: Partial<PrintElement> = {}): PrintElement =>
  ({ id: "qr", type: "qr", x: 40, y: 60, width: 60, height: 60, rotation: 0, opacity: 1, style: "classic", foreground: "#050505", background: null, ...overrides }) as PrintElement;

function doc(elements: PrintElement[], background: Partial<PrintDoc["background"]> = {}): PrintDoc {
  const base = emptyDoc();
  return { ...base, background: { ...base.background, ...background }, elements };
}

const keys = (design: PrintDoc, size = A5, assets = new Map<string, { width: number; height: number }>()) =>
  checkDesign({ doc: design, size, qrModules: MODULES, assets }).map((finding) => `${finding.level}:${finding.key}`);

describe("the export checks", () => {
  it("pass a plain dark code on white, well inside the page", () => {
    expect(keys(doc([qr()]))).toEqual([]);
  });

  it("measure the code without its quiet zone", () => {
    expect(qrCodeMm({ width: 41 }, 33)).toBeCloseTo(33);
  });

  it("warn when the code is under 2.5 cm across", () => {
    expect(keys(doc([qr({ width: 28, height: 28 })]))).toContain("warning:qr-small-qr");
    expect(keys(doc([qr({ width: 32, height: 32 })]))).not.toContain("warning:qr-small-qr");
  });

  it("hold a story's code to a share of the screen instead", () => {
    const story = { preset: "story", widthMm: 90, heightMm: 160, bleedMm: 0, digital: true };
    expect(keys(doc([qr({ width: 15, height: 15 })]), story)).toContain("warning:qr-small-qr");
    expect(keys(doc([qr({ width: 40, height: 40 })]), story)).toEqual([]);
  });

  it("warn about low contrast against what is actually behind the code", () => {
    const pale = { id: "card", type: "rect", x: 30, y: 50, width: 80, height: 80, rotation: 0, opacity: 1, fill: "#555555", stroke: null, strokeWidth: 0, radius: 0 } as PrintElement;
    expect(keys(doc([pale, qr()]))).toContain("warning:qr-contrast-qr");
    expect(keys(doc([pale, qr({ background: "#ffffff" })]))).not.toContain("warning:qr-contrast-qr");
    expect(keys(doc([qr()], { color: "#555555" }))).toContain("warning:qr-contrast-qr");
  });

  it("warn about a light code on a dark ground", () => {
    expect(keys(doc([qr({ foreground: "#ffffff" })], { color: "#050505" }))).toContain("warning:qr-inverted-qr");
  });

  it("say when only reading the page can judge a code on a photo", () => {
    expect(keys(doc([qr()], { assetId: "photo" }))).toContain("notice:qr-photo-qr");
  });

  it("warn when something is drawn over the code", () => {
    const sticker = { id: "star", type: "icon", icon: "star", x: 90, y: 100, width: 20, height: 20, rotation: 0, opacity: 1, color: "#050505" } as PrintElement;
    expect(keys(doc([qr(), sticker]))).toContain("warning:qr-covered-qr");
    expect(keys(doc([sticker, qr()]))).not.toContain("warning:qr-covered-qr");
  });

  it("warn when words or a code cross the cut, and note when they are close to it", () => {
    expect(keys(doc([qr({ x: 120 })]))).toContain("warning:cut-qr");
    expect(keys(doc([qr({ x: 86 })]))).toContain("notice:edge-qr");
  });

  it("catch a turned element by its corners, not its stored box", () => {
    // Upright it sits inside the page; turned, one corner rises past the top.
    expect(keys(doc([qr({ x: 60, y: 10 })]))).not.toContain("warning:cut-qr");
    expect(keys(doc([qr({ x: 60, y: 10, rotation: -45 })]))).toContain("warning:cut-qr");
  });

  it("warn when a shape runs off the page but not as far as the bleed", () => {
    const band = (x: number, width: number) =>
      ({ id: "band", type: "rect", x, y: 0, width, height: 20, rotation: 0, opacity: 1, fill: "#edee00", stroke: null, strokeWidth: 0, radius: 0 }) as PrintElement;
    expect(keys(doc([band(-1, 150)]))).toContain("warning:bleed-band");
    expect(keys(doc([band(-3, 154)]))).not.toContain("warning:bleed-band");
  });

  it("warn about a photo under 150 pixels per inch at its placed size, the background's included", () => {
    const photo = { id: "photo", type: "image", assetId: "a1", x: 10, y: 10, width: 100, height: 75, rotation: 0, opacity: 1, fit: "cover", radius: 0 } as PrintElement;
    expect(keys(doc([photo, qr({ y: 120 })]), A5, new Map([["a1", { width: 400, height: 300 }]]))).toContain("warning:dpi-photo");
    expect(keys(doc([photo, qr({ y: 120 })]), A5, new Map([["a1", { width: 2400, height: 1800 }]]))).not.toContain("warning:dpi-photo");
    expect(keys(doc([qr()], { assetId: "bg" }), A5, new Map([["bg", { width: 600, height: 800 }]]))).toContain("warning:dpi-background");
  });

  it("work out pixels per inch for a photo cropped to fill its frame", () => {
    expect(imageDpi({ widthMm: 25.4, heightMm: 25.4 }, { width: 300, height: 600 }, "cover")).toBeCloseTo(300);
    expect(imageDpi({ widthMm: 25.4, heightMm: 25.4 }, { width: 300, height: 600 }, "contain")).toBeCloseTo(600);
  });

  it("note bright greens and blues, but not the yellows and reds inks print well", () => {
    expect(printsDuller("#00ff66")).toBe(true);
    expect(printsDuller("#2244ff")).toBe(true);
    expect(printsDuller("#edee00")).toBe(false);
    expect(printsDuller("#e8001c")).toBe(false);
    expect(printsDuller("#050505")).toBe(false);
    expect(keys(doc([qr()], { color: "#2244ff" }))).toContain("notice:cmyk");
    expect(keys(doc([qr()]))).not.toContain("notice:cmyk");
  });

  it("note a design with no code at all", () => {
    expect(keys(doc([]))).toContain("notice:qr-missing");
  });
});
