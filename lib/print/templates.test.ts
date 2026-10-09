import { describe, expect, it } from "vitest";
import { qrModuleCount } from "../qr-shapes";
import { docSchema } from "./doc";
import { checkDesign } from "./guardrails";
import { findPreset, isDigital } from "./presets";
import { PRINT_TEMPLATES, VOLT, eventDateLabel, fitTextSize } from "./templates";

const SHORT_URL = "https://klik.kreativvantage.com/e/ana-x1y2z3";
const LONG_URL = `https://klik.kreativvantage.com/e/${"the-wedding-of-anastasia-and-maximilian-".repeat(1)}x1y2z3`;

const contexts = [
  { eventName: "Ana & Leo", dateLabel: "Sunday, June 14, 2026", accent: VOLT },
  {
    eventName: "The Wedding of Anastasia Konstantinopoulou and Maximilian Featherstonehaugh",
    dateLabel: null,
    accent: "#1d2b64",
  },
];

describe("the starter templates", () => {
  it("are eleven, one per size the roadmap names, each on a real preset", () => {
    expect(PRINT_TEMPLATES).toHaveLength(11);
    expect(new Set(PRINT_TEMPLATES.map((template) => template.key)).size).toBe(11);
    for (const template of PRINT_TEMPLATES) expect(findPreset(template.preset), template.key).not.toBeNull();
  });

  for (const template of PRINT_TEMPLATES) {
    for (const context of contexts) {
      for (const url of [SHORT_URL, LONG_URL]) {
        it(`${template.key} is a valid design that passes every export check (${context.accent}, ${url.length} characters)`, () => {
          const doc = template.build(context);
          expect(docSchema.safeParse(doc).success).toBe(true);
          const preset = findPreset(template.preset)!;
          const findings = checkDesign({
            doc,
            size: { preset: preset.key, widthMm: preset.widthMm, heightMm: preset.heightMm, bleedMm: preset.bleedMm, digital: isDigital({ preset: preset.key }) },
            qrModules: qrModuleCount(url),
            assets: new Map(),
          });
          expect(findings.filter((finding) => finding.level === "warning")).toEqual([]);
          expect(findings.map((finding) => finding.key)).not.toContain("qr-missing");
        });
      }
    }
  }

  it("give every element its own id", () => {
    const doc = PRINT_TEMPLATES.find((template) => template.key === "sticker-sheet")!.build(contexts[0]);
    expect(new Set(doc.elements.map((element) => element.id)).size).toBe(doc.elements.length);
  });

  it("shrink a long event name to fit rather than run into the code", () => {
    expect(fitTextSize("Ana & Leo", 54, 30, 170, 2, 1.08)).toBe(54);
    expect(fitTextSize(contexts[1].eventName, 54, 30, 170, 2, 1.08)).toBeLessThan(54);
  });

  it("write an event's date the way people read it, on the day it was set", () => {
    expect(eventDateLabel(new Date("2026-06-14T00:00:00Z"))).toBe("Sunday, June 14, 2026");
    expect(eventDateLabel(null)).toBeNull();
  });
});
