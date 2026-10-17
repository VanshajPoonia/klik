import { describe, expect, it } from "vitest";
import { isWholeClip, needsConversion, pictureNeedsEncoding, targetBitrate, targetSize, type ClipFacts } from "./video-compress";

/** What Klik's own camera records in Chrome: already fine. */
const cameraClip: ClipFacts = {
  codec: "avc",
  width: 720,
  height: 1280,
  framesPerSecond: 30,
  bitsPerSecond: 2_500_000,
  container: "video/mp4",
  audioCodec: "aac",
};

describe("targetSize", () => {
  it("brings an iPhone's 4K down to 1080p, upright, on its long edge", () => {
    expect(targetSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(targetSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it("leaves anything at or under 1080p as it is", () => {
    expect(targetSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(targetSize(720, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("keeps both sides even, which H.264 needs", () => {
    const { width, height } = targetSize(1001, 2999);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
    expect(height).toBe(1920);
  });
});

describe("targetBitrate", () => {
  it("is about 4.7 Mbps for a full 1080p picture filmed heavier than that", () => {
    expect(targetBitrate(1080, 1920, 20_000_000)).toBe(4_700_000);
  });

  it("scales down with the picture", () => {
    expect(targetBitrate(720, 1280, 20_000_000)).toBeLessThan(2_500_000);
  });

  it("never makes a light clip heavier than the same picture needs", () => {
    // A 1 Mbps VP9 recording becomes 1.7 Mbps of H.264, not 4.7.
    expect(targetBitrate(1080, 1920, 1_000_000)).toBe(1_700_000);
    expect(targetBitrate(1080, 1920, 100_000)).toBe(600_000);
  });
});

describe("needsConversion", () => {
  it("leaves Klik's own camera recordings alone", () => {
    expect(needsConversion(cameraClip)).toBe(false);
  });

  it("converts an iPhone's HEVC, which many browsers cannot show", () => {
    expect(needsConversion({ ...cameraClip, codec: "hevc", container: "video/quicktime" })).toBe(true);
    expect(pictureNeedsEncoding({ ...cameraClip, codec: "hevc" })).toBe(true);
  });

  it("converts what is too big, too fast or too heavy, even in H.264", () => {
    expect(pictureNeedsEncoding({ ...cameraClip, width: 2160, height: 3840 })).toBe(true);
    expect(pictureNeedsEncoding({ ...cameraClip, framesPerSecond: 60 })).toBe(true);
    expect(pictureNeedsEncoding({ ...cameraClip, bitsPerSecond: 17_000_000 })).toBe(true);
    // A variable frame rate that averages a hair over 30 is still 30.
    expect(pictureNeedsEncoding({ ...cameraClip, framesPerSecond: 30.4 })).toBe(false);
  });

  it("copies the picture when only the sound or the container needs changing", () => {
    const opus = { ...cameraClip, audioCodec: "opus" };
    expect(needsConversion(opus)).toBe(true);
    expect(pictureNeedsEncoding(opus)).toBe(false);
    const webm = { ...cameraClip, container: "video/webm" };
    expect(needsConversion(webm)).toBe(true);
    expect(pictureNeedsEncoding(webm)).toBe(false);
  });

  it("takes a clip with no sound as it is", () => {
    expect(needsConversion({ ...cameraClip, audioCodec: null })).toBe(false);
  });
});

describe("isWholeClip", () => {
  const original = { seconds: 60, sound: true };

  it("takes a copy that runs the length of the clip, allowing for a frame or two", () => {
    expect(isWholeClip({ seconds: 60, picture: true, sound: true }, original)).toBe(true);
    expect(isWholeClip({ seconds: 59.2, picture: true, sound: true }, original)).toBe(true);
  });

  it("refuses one cut short, which would lose the end of a guest's video", () => {
    expect(isWholeClip({ seconds: 41, picture: true, sound: true }, original)).toBe(false);
    expect(isWholeClip({ seconds: 2.2, picture: true, sound: false }, { seconds: 3, sound: false })).toBe(false);
  });

  it("refuses one that lost its picture or its sound", () => {
    expect(isWholeClip({ seconds: 60, picture: false, sound: true }, original)).toBe(false);
    expect(isWholeClip({ seconds: 60, picture: true, sound: false }, original)).toBe(false);
    expect(isWholeClip({ seconds: 60, picture: true, sound: false }, { seconds: 60, sound: false })).toBe(true);
  });
});
