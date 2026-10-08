import { describe, expect, it } from "vitest";
import { thumbnailSize } from "./thumbnail-size";

describe("thumbnailSize", () => {
  it("brings a phone photo down to 480 on its short side", () => {
    expect(thumbnailSize(4032, 3024)).toEqual({ width: 640, height: 480 });
    expect(thumbnailSize(3024, 4032)).toEqual({ width: 480, height: 640 });
  });

  it("caps the long side, so a panorama is not a full image under another name", () => {
    expect(thumbnailSize(8000, 2000)).toEqual({ width: 960, height: 240 });
  });

  it("never enlarges something already small", () => {
    expect(thumbnailSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it("refuses nonsense dimensions rather than dividing by zero", () => {
    expect(thumbnailSize(0, 100)).toEqual({ width: 0, height: 0 });
  });
});
