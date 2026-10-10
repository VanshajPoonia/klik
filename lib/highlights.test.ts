import { describe, expect, it } from "vitest";
import { exposureScore, pickHighlights, type HighlightCandidate } from "./highlights";

const MINUTE = 60_000;

/** A photo with its own scene (hash) so it never reads as a burst. */
function photo(index: number, overrides: Partial<HighlightCandidate> = {}): HighlightCandidate {
  return {
    id: `p${index}`,
    hash: ((index * 2654435761) >>> 0).toString(16).padStart(8, "0").repeat(2),
    sharpness: 100,
    brightness: 0.5,
    hearts: 0,
    comments: 0,
    momentId: null,
    at: index * 3 * MINUTE,
    highlight: null,
    ...overrides,
  };
}

describe("AI-8 highlights", () => {
  it("rates light sensibly", () => {
    expect(exposureScore(0.5)).toBe(1);
    expect(exposureScore(0.02)).toBe(0);
    expect(exposureScore(0.98)).toBe(0);
    expect(exposureScore(0.15)).toBeGreaterThan(0);
    expect(exposureScore(0.15)).toBeLessThan(1);
  });

  it("always includes a pinned photo and never an excluded one", () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => photo(i, { hearts: 5, sharpness: 200 })),
      photo(40, { sharpness: 1, brightness: 0.02, highlight: "pinned" }),
      photo(41, { sharpness: 900, hearts: 50, highlight: "excluded" }),
    ];
    const { picks, runnersUp } = pickHighlights(items, 5);
    expect(picks).toHaveLength(5);
    expect(picks).toContain("p40");
    expect(picks).not.toContain("p41");
    expect(runnersUp).not.toContain("p41");
  });

  it("prefers what guests loved, among photos alike in every other way", () => {
    const items = Array.from({ length: 12 }, (_, i) => photo(i, { hearts: i === 7 ? 9 : 0, momentId: `m${i}` }));
    expect(pickHighlights(items, 1).picks).toEqual(["p7"]);
  });

  it("takes one frame from a burst, and leaves out the blurry and the black", () => {
    const burst = [0, 1, 2].map((offset) =>
      photo(100 + offset, { hash: `000000000000000${offset}`, at: 500 * MINUTE + offset * 1000, hearts: 3, sharpness: 300 }),
    );
    const items = [
      ...Array.from({ length: 12 }, (_, i) => photo(i)),
      ...burst,
      photo(50, { sharpness: 1, hearts: 20 }),
      photo(51, { brightness: 0.01, hearts: 20 }),
    ];
    const { picks } = pickHighlights(items, 20);
    expect(picks.filter((id) => burst.some((frame) => frame.id === id))).toHaveLength(1);
    expect(picks).not.toContain("p50");
    expect(picks).not.toContain("p51");
  });

  it("spreads the picks across the moments of the night", () => {
    const dinner = Array.from({ length: 20 }, (_, i) => photo(i, { momentId: "dinner", hearts: 8, sharpness: 300 }));
    const speeches = Array.from({ length: 5 }, (_, i) => photo(50 + i, { momentId: "speeches", hearts: 1 }));
    const dancing = Array.from({ length: 5 }, (_, i) => photo(80 + i, { momentId: "dancing", hearts: 1 }));
    const { picks } = pickHighlights([...dinner, ...speeches, ...dancing], 9);
    const from = (ids: string[], moment: HighlightCandidate[]) => ids.filter((id) => moment.some((item) => item.id === id)).length;
    expect(from(picks, speeches)).toBeGreaterThan(0);
    expect(from(picks, dancing)).toBeGreaterThan(0);
    expect(from(picks, dinner)).toBeLessThan(9);
  });

  it("lists the picks in the order they were taken, and skips the unmeasured", () => {
    const items = [photo(3), photo(1), photo(2), photo(9, { sharpness: null, hearts: 40 })];
    expect(pickHighlights(items, 10).picks).toEqual(["p1", "p2", "p3"]);
  });
});
