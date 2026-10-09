import { describe, expect, it } from "vitest";
import { containIn, coverCrop, linkedMediaId, photoLink, shareFilename, smallerCopySize } from "./media-share";

describe("links to one photo", () => {
  it("point into the gallery, escaped", () => {
    expect(photoLink("https://klik.test", "ana-and-sam", "abc_123")).toBe("https://klik.test/e/ana-and-sam?m=abc_123");
    expect(photoLink("https://klik.test", "a b", "x/y")).toBe("https://klik.test/e/a%20b?m=x%2Fy");
  });

  it("are read back only when they look like a media id", () => {
    expect(linkedMediaId("V1StGXR8_Z5jdHi6B-myT")).toBe("V1StGXR8_Z5jdHi6B-myT");
    expect(linkedMediaId(["a", "b"])).toBeNull();
    expect(linkedMediaId("")).toBeNull();
    expect(linkedMediaId("../../etc")).toBeNull();
    expect(linkedMediaId("x".repeat(65))).toBeNull();
    expect(linkedMediaId(undefined)).toBeNull();
  });
});

describe("file names", () => {
  it("match the download route's, with the right extension", () => {
    expect(shareFilename("party", "abcdefghijk", "image/jpeg")).toBe("party-abcdefgh.jpg");
    expect(shareFilename("party", "abcdefghijk", "video/quicktime")).toBe("party-abcdefgh.mov");
    expect(shareFilename("party", "abcdefghijk", "image/jpeg", "-story")).toBe("party-abcdefgh-story.jpg");
    expect(shareFilename("party", "abcdefghijk", "video/x-matroska; codecs=avc1")).toBe("party-abcdefgh.xmatroska");
  });
});

describe("the smaller copy", () => {
  it("brings the long edge to 1600 and never enlarges", () => {
    expect(smallerCopySize(2560, 1920)).toEqual({ width: 1600, height: 1200 });
    expect(smallerCopySize(1440, 2560)).toEqual({ width: 900, height: 1600 });
    expect(smallerCopySize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("story geometry", () => {
  it("fits a landscape photo inside the frame, centred", () => {
    expect(containIn(4000, 3000, { x: 64, y: 96, w: 952, h: 1424 })).toEqual({ x: 64, y: 451, w: 952, h: 714 });
  });

  it("crops the backdrop to the story's shape from the middle", () => {
    expect(coverCrop(1600, 1200, 9 / 16)).toEqual({ sx: 462.5, sy: 0, sw: 675, sh: 1200 });
    expect(coverCrop(900, 3200, 9 / 16)).toEqual({ sx: 0, sy: 800, sw: 900, sh: 1600 });
  });
});
