import { describe, expect, it } from "vitest";
import {
  blurryPhotos,
  differenceHash,
  hammingDistance,
  hiddenBy,
  laplacianVariance,
  meanBrightness,
  similarGroups,
  tidyPlan,
  type TidyCandidate,
} from "./image-analysis";

const gradient = (shift = 0) => Uint8Array.from({ length: 72 }, (_, i) => ((i % 9) * 20 + shift) % 256);

describe("AI-7 measuring a photo", () => {
  it("hashes alike images alike and different ones apart", () => {
    const a = differenceHash(gradient());
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(a, differenceHash(gradient(3)))).toBeLessThanOrEqual(6);
    const reversed = Uint8Array.from(gradient()).reverse();
    expect(hammingDistance(a, differenceHash(reversed))).toBeGreaterThan(30);
  });

  it("scores a sharp edge above a soft one, and reads brightness", () => {
    const size = 32;
    const sharp = Uint8Array.from({ length: size * size }, (_, i) => ((i % size) < size / 2 ? 0 : 255));
    const soft = Uint8Array.from({ length: size * size }, (_, i) => Math.round(((i % size) / (size - 1)) * 255));
    expect(laplacianVariance(sharp, size, size)).toBeGreaterThan(laplacianVariance(soft, size, size) * 10);
    expect(meanBrightness(new Uint8Array([0, 255]))).toBeCloseTo(0.5);
  });
});

describe("AI-7 grouping and blur", () => {
  const minute = 60_000;
  it("groups near-identical frames taken close together, sharpest first, and leaves singles out", () => {
    const groups = similarGroups([
      { id: "toast-1", hash: "ffff0000ffff0000", sharpness: 50, at: 0 },
      { id: "toast-2", hash: "ffff0000ffff0001", sharpness: 90, at: minute },
      { id: "toast-3", hash: "ffff0000ffff0003", sharpness: 70, at: 2 * minute },
      { id: "cake", hash: "0123456789abcdef", sharpness: 80, at: 3 * minute },
      // The same look an hour later is another moment, not a duplicate.
      { id: "toast-later", hash: "ffff0000ffff0000", sharpness: 99, at: 70 * minute },
    ]);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([["toast-2", "toast-3", "toast-1"]]);
  });

  it("calls only the clearly soft photos blurry, and only with enough to compare", () => {
    const photos = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, sharpness: 100 }));
    photos[3] = { id: "soft", sharpness: 20 };
    expect(blurryPhotos(photos)).toEqual(["soft"]);
    expect(blurryPhotos(photos.slice(0, 5))).toEqual([]);
  });
});

describe("AI-7 a tidy", () => {
  const MINUTE = 60_000;
  // Twelve ordinary photos, each its own scene, so a median exists.
  const scenery: TidyCandidate[] = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    contentHash: `c${i}`,
    hash: (i * 0x1111).toString(16).padStart(4, "0").repeat(4),
    sharpness: 100 + i,
    at: i * 30 * MINUTE,
    pinned: false,
  }));
  const plain = (overrides: Partial<TidyCandidate> & { id: string }): TidyCandidate => ({
    contentHash: null,
    hash: null,
    sharpness: null,
    at: 0,
    pinned: false,
    ...overrides,
  });

  it("keeps the first copy of a file sent twice, however far apart", () => {
    const { groups } = tidyPlan([
      plain({ id: "later", contentHash: "same", at: 5 * 60 * MINUTE }),
      plain({ id: "first", contentHash: "same", at: 0 }),
    ]);
    expect(groups).toEqual([{ ids: ["first", "later"], keep: "first", exact: true }]);
  });

  it("keeps the sharpest of a burst, or the pinned one, and never offers a pinned photo", () => {
    const burst = [
      plain({ id: "soft", hash: "00000000000000ff", sharpness: 10, at: 6 * 60 * MINUTE }),
      plain({ id: "crisp", hash: "00000000000000fe", sharpness: 90, at: 6 * 60 * MINUTE + 5000 }),
      plain({ id: "ok", hash: "00000000000000fc", sharpness: 50, at: 6 * 60 * MINUTE + 9000 }),
    ];
    const [group] = tidyPlan(burst).groups;
    expect(group.keep).toBe("crisp");
    expect(hiddenBy(group, group.keep, new Set())).toEqual(["ok", "soft"]);

    const pinnedSoft = burst.map((item) => (item.id === "soft" ? { ...item, pinned: true } : item));
    const [kept] = tidyPlan(pinnedSoft).groups;
    expect(kept.keep).toBe("soft");
    // A second pinned frame in the same burst is kept too.
    expect(hiddenBy(kept, "crisp", new Set(["soft"]))).toEqual(["ok"]);
  });

  it("offers blurry photos only when they are in no group and not pinned", () => {
    const items = [
      ...scenery,
      plain({ id: "blur", hash: "f0f0f0f0f0f0f0f0", sharpness: 5, at: 13 * 30 * MINUTE }),
      plain({ id: "blur-pinned", hash: "0f0f0f0f0f0f0f0f", sharpness: 4, at: 14 * 30 * MINUTE, pinned: true }),
    ];
    expect(tidyPlan(items).blurry).toEqual(["blur"]);
  });

  it("does not offer the same photo for hiding twice", () => {
    const items = [
      plain({ id: "a", contentHash: "x", hash: "0000000000000000", sharpness: 9, at: 0 }),
      plain({ id: "b", contentHash: "x", hash: "0000000000000000", sharpness: 9, at: 1000 }),
      plain({ id: "c", hash: "0000000000000001", sharpness: 1, at: 2000 }),
    ];
    const { groups, blurry } = tidyPlan(items);
    const offered = [...groups.flatMap((group) => hiddenBy(group, group.keep, new Set())), ...blurry];
    expect(offered.sort()).toEqual(["b", "c"]);
    // The copy is only in the exact group; the near group holds its keeper.
    expect(groups.find((group) => !group.exact)?.ids.sort()).toEqual(["a", "c"]);
  });
});
