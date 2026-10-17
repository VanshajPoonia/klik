import { describe, expect, it } from "vitest";
import { galleryPalette } from "./color";
import {
  GALLERY_TEMPLATES,
  KLIK_COLORS,
  OCCASIONS,
  eventColors,
  eventTemplate,
  fieldsForTemplate,
  matchColorway,
  matchTemplate,
  resolveTemplateChoice,
  templateByKey,
  templateHeading,
  templatesFor,
} from "./gallery-templates";

const colorways = GALLERY_TEMPLATES.flatMap((template) => template.colorways.map((colorway) => ({ template, colorway })));

describe("gallery templates", () => {
  it("has unique template keys, unique colourway keys and unique colour pairs, so a pair always names one look", () => {
    const keys = GALLERY_TEMPLATES.map((template) => template.key);
    const colorwayKeys = colorways.map(({ colorway }) => colorway.key);
    const pairs = colorways.map(({ colorway }) => `${colorway.accent}/${colorway.background}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(colorwayKeys).size).toBe(colorwayKeys.length);
    expect(new Set(pairs).size).toBe(pairs.length);
    // A colourway key that is also a look key would make resolveTemplateChoice ambiguous.
    for (const key of colorwayKeys.filter((key) => key !== "plain")) expect(keys).not.toContain(key);
  });

  it("stores colours in lower case, which is how they are matched", () => {
    for (const { colorway } of colorways) {
      expect(colorway.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(colorway.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("shows guests exactly the swatch the host picked: no accent needs adjusting", () => {
    for (const { template, colorway } of colorways) {
      expect(galleryPalette(colorway.accent, colorway.background).accentAdjusted, `${template.key}/${colorway.key}`).toBe(false);
    }
  });

  it("offers two wedding looks first, one black and one white", () => {
    const wedding = templatesFor("wedding");
    expect(wedding.slice(0, 2).map((template) => template.key)).toEqual(["black-tie", "white-lace"]);
    expect(galleryPalette(wedding[0].colorways[0].accent, wedding[0].colorways[0].background).light).toBe(false);
    expect(galleryPalette(wedding[1].colorways[0].accent, wedding[1].colorways[0].background).light).toBe(true);
  });

  it("offers every kind of event a look of its own, Modern and Plain", () => {
    for (const occasion of OCCASIONS) {
      const offered = templatesFor(occasion.key).map((template) => template.key);
      expect(offered, occasion.key).toContain("modern");
      expect(offered, occasion.key).toContain("plain");
      expect(offered.length, occasion.key).toBeGreaterThanOrEqual(3);
    }
    expect(templatesFor("other")).toHaveLength(GALLERY_TEMPLATES.length);
  });

  it("still knows every pair shipped on 2026-10-16, so those galleries keep their colours", () => {
    const shipped: Record<string, [string, string]> = {
      ivory: ["#8a6a3b", "#f6f1e6"],
      midnight: ["#e6cf9f", "#0f1420"],
      confetti: ["#ff4f8b", "#1c0f22"],
      sunshine: ["#c2410c", "#fff6e0"],
      sorbet: ["#b8456b", "#fdf0f2"],
      sage: ["#3f6b4e", "#eef3ec"],
      "cap-and-gown": ["#f2c14e", "#0c1626"],
      chalkboard: ["#7ee0b5", "#141a17"],
      "porch-light": ["#f5a524", "#14100b"],
      "after-hours": ["#5cb8ff", "#0a0c10"],
      cobalt: ["#1f5eff", "#f5f6f8"],
    };
    for (const [key, [accent, background]] of Object.entries(shipped)) {
      expect(matchColorway(accent, background)?.colorway.key, key).toBe(key);
      expect(resolveTemplateChoice(key)?.colorway.key, key).toBe(key);
    }
  });

  it("matches a pair whatever its case", () => {
    expect(matchTemplate("#FF4F8B", "#1C0F22")?.key).toBe("party");
    expect(matchTemplate("#ff4f8b", "#000000")).toBeNull();
    expect(matchTemplate(null, "#1c0f22")).toBeNull();
  });

  it("resolves a look to its first colourway, or to the colourway asked for", () => {
    expect(resolveTemplateChoice("black-tie")?.colorway.key).toBe("champagne");
    expect(resolveTemplateChoice("black-tie", "silver")?.colorway.key).toBe("silver");
    expect(resolveTemplateChoice("black-tie", "confetti")?.colorway.key).toBe("champagne");
    expect(resolveTemplateChoice("nonsense")).toBeNull();
  });
});

describe("eventTemplate", () => {
  it("prefers the stored look, then the colours, then Plain", () => {
    expect(eventTemplate({ templateKey: "diploma", accentColor: "#ff4f8b", backgroundColor: "#1c0f22" }).key).toBe("diploma");
    expect(eventTemplate({ templateKey: null, accentColor: "#ff4f8b", backgroundColor: "#1c0f22" }).key).toBe("party");
    expect(eventTemplate({ templateKey: null, accentColor: "#123456", backgroundColor: "#abcdef" }).key).toBe("plain");
    expect(eventTemplate({ templateKey: "gone", accentColor: "#123456", backgroundColor: "#abcdef" }).key).toBe("plain");
  });
});

describe("template fields", () => {
  const blackTie = templateByKey("black-tie")!;
  const party = templateByKey("party")!;

  it("keeps only what the look asks for, trimmed and capped", () => {
    expect(
      fieldsForTemplate(blackTie, { names: [" Ana ", "Bo"], name: "ignored", age: 30, message: "  hi  " }),
    ).toEqual({ names: ["Ana", "Bo"], message: "hi" });
    expect(fieldsForTemplate(party, { age: 30.5 })).toEqual({});
    expect(fieldsForTemplate(party, { age: 0 })).toEqual({});
    expect(fieldsForTemplate(party, { name: "x".repeat(80) }).name).toHaveLength(40);
    expect(fieldsForTemplate(blackTie, { names: ["", ""] })).toEqual({});
    expect(fieldsForTemplate(blackTie, { showDate: false })).toEqual({ showDate: false });
  });

  it("heads the gallery with the couple, one name, or the event's name", () => {
    expect(templateHeading(blackTie, { names: ["Ana", "Bo"] }, "Wedding")).toEqual({ names: ["Ana", "Bo"], title: "Ana & Bo" });
    expect(templateHeading(blackTie, { names: ["Ana", ""] }, "Wedding")).toEqual({ names: null, title: "Ana" });
    expect(templateHeading(blackTie, {}, "Ana & Bo's wedding").title).toBe("Ana & Bo's wedding");
    expect(templateHeading(party, { name: "Maya" }, "Party").title).toBe("Maya");
  });
});

describe("eventColors", () => {
  const confetti = { accentColor: "#ff4f8b", backgroundColor: "#1c0f22" };
  const custom = { accentColor: "#123456", backgroundColor: "#abcdef" };

  it("shows a colourway on a plan that cannot customise", () => {
    expect(eventColors(confetti, false)).toEqual({ accent: "#ff4f8b", background: "#1c0f22" });
  });

  it("keeps Premium's own colours to Premium", () => {
    expect(eventColors(custom, false)).toEqual(KLIK_COLORS);
    expect(eventColors(custom, true)).toEqual({ accent: "#123456", background: "#abcdef" });
  });

  it("shows Klik's colours for the database defaults, which match no colourway", () => {
    expect(eventColors({ accentColor: "#e8f000", backgroundColor: "#090a08" }, false)).toEqual(KLIK_COLORS);
  });
});
