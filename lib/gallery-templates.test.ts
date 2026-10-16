import { describe, expect, it } from "vitest";
import { galleryPalette } from "./color";
import {
  GALLERY_TEMPLATES,
  KLIK_COLORS,
  OCCASIONS,
  eventColors,
  matchTemplate,
  templatesFor,
} from "./gallery-templates";

describe("gallery templates", () => {
  it("has unique keys and unique colour pairs, so a pair always names one template", () => {
    const keys = GALLERY_TEMPLATES.map((template) => template.key);
    const pairs = GALLERY_TEMPLATES.map((template) => `${template.accent}/${template.background}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("stores colours in lower case, which is how they are matched", () => {
    for (const template of GALLERY_TEMPLATES) {
      expect(template.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(template.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("shows guests exactly the swatch the host picked: no accent needs adjusting", () => {
    for (const template of GALLERY_TEMPLATES) {
      expect(galleryPalette(template.accent, template.background).accentAdjusted, template.key).toBe(false);
    }
  });

  it("offers Plain and at least two looks of its own for every kind of event", () => {
    for (const occasion of OCCASIONS) {
      const offered = templatesFor(occasion.key);
      expect(offered[0].key).toBe("plain");
      expect(offered.length, occasion.key).toBeGreaterThanOrEqual(3);
    }
    expect(templatesFor("other")).toHaveLength(GALLERY_TEMPLATES.length);
  });

  it("matches a pair whatever its case", () => {
    expect(matchTemplate("#FF4F8B", "#1C0F22")?.key).toBe("confetti");
    expect(matchTemplate("#ff4f8b", "#000000")).toBeNull();
    expect(matchTemplate(null, "#1c0f22")).toBeNull();
  });
});

describe("eventColors", () => {
  const confetti = { accentColor: "#ff4f8b", backgroundColor: "#1c0f22" };
  const custom = { accentColor: "#123456", backgroundColor: "#abcdef" };

  it("shows a template on a plan that cannot customise", () => {
    expect(eventColors(confetti, false)).toEqual({ accent: "#ff4f8b", background: "#1c0f22" });
  });

  it("keeps Premium's own colours to Premium", () => {
    expect(eventColors(custom, false)).toEqual(KLIK_COLORS);
    expect(eventColors(custom, true)).toEqual({ accent: "#123456", background: "#abcdef" });
  });

  it("shows Klik's colours for the database defaults, which match no template", () => {
    expect(eventColors({ accentColor: "#e8f000", backgroundColor: "#090a08" }, false)).toEqual(KLIK_COLORS);
  });
});
