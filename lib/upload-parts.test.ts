import { describe, expect, it } from "vitest";
import { PART_SIZE, partSizes } from "./upload-parts";

describe("partSizes", () => {
  it("cuts equal parts with a shorter last one, as R2 requires", () => {
    expect(partSizes(PART_SIZE * 2 + 5)).toEqual([PART_SIZE, PART_SIZE, 5]);
  });

  it("does not add an empty last part when the size divides exactly", () => {
    expect(partSizes(PART_SIZE * 3)).toEqual([PART_SIZE, PART_SIZE, PART_SIZE]);
  });

  it("always adds up to the file", () => {
    const total = 200 * 1024 * 1024 + 12345;
    expect(partSizes(total).reduce((sum, size) => sum + size, 0)).toBe(total);
  });
});
