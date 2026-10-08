import { describe, expect, it } from "vitest";
import { fillGaps } from "./insights";

describe("fillGaps", () => {
  it("puts zeros in the quiet hours, so the lull shows", () => {
    const filled = fillGaps(
      [
        { bucket: "2026-10-10T20:00:00.000Z", uploads: 5 },
        { bucket: "2026-10-10T23:00:00.000Z", uploads: 2 },
      ],
      "hour",
    );
    expect(filled.map((row) => row.uploads)).toEqual([5, 0, 0, 2]);
  });

  it("leaves a single bucket alone", () => {
    expect(fillGaps([{ bucket: "2026-10-10T20:00:00.000Z", uploads: 1 }], "day")).toHaveLength(1);
  });
});
