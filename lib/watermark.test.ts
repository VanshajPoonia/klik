import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { stampPlacement } from "./watermark-layout";
import { normalizeBuyUrl } from "./watermark-settings";
import { isReservedMediaId, uploadMediaId } from "./media-id";
import { cleanOriginalFor, isLockedProof } from "./proof-access";
import { watermarkPhoto } from "./watermark";

describe("MED-10 stamp placement", () => {
  const photo = { width: 3000, height: 2000 };
  const stamp = { width: 1600, height: 400 };

  it("puts a corner stamp inside the photo, a margin from the edge", () => {
    const right = stampPlacement(photo, stamp, "bottom-right", 0.3);
    expect(right).toEqual({ tile: false, width: 900, height: 225, left: 3000 - 900 - 60, top: 2000 - 225 - 60 });
    const left = stampPlacement(photo, stamp, "bottom-left", 0.3);
    expect(left.tile === false && left.left).toBe(60);
  });

  it("centres a larger stamp in the middle", () => {
    const middle = stampPlacement(photo, stamp, "center", 0.3);
    expect(middle).toMatchObject({ tile: false, width: 1440, height: 360, left: 780, top: 820 });
  });

  it("tiles a smaller stamp with space around it", () => {
    expect(stampPlacement(photo, stamp, "tiled", 0.3)).toEqual({ tile: true, width: 630, height: 158, gapX: 378, gapY: 253 });
  });

  it("holds a tall stamp to part of the photo's height, and never wider than the photo", () => {
    const tall = stampPlacement(photo, { width: 400, height: 1000 }, "bottom-right", 0.6);
    expect(tall.height).toBeLessThanOrEqual(700);
    const tiny = stampPlacement({ width: 100, height: 4000 }, stamp, "center", 0.6);
    expect(tiny.width).toBeLessThanOrEqual(90);
  });
});

describe("MED-10 the buy link", () => {
  it("accepts a web page or an email address, and nothing else", () => {
    expect(normalizeBuyUrl("you@studio.com")).toEqual({ ok: true, url: "mailto:you@studio.com" });
    expect(normalizeBuyUrl("mailto:you@studio.com")).toEqual({ ok: true, url: "mailto:you@studio.com" });
    expect(normalizeBuyUrl("https://studio.com/buy")).toEqual({ ok: true, url: "https://studio.com/buy" });
    expect(normalizeBuyUrl("  ")).toEqual({ ok: true, url: null });
    expect(normalizeBuyUrl("http://studio.com")).toEqual({ ok: false });
    expect(normalizeBuyUrl("javascript:alert(1)")).toEqual({ ok: false });
    expect(normalizeBuyUrl("https://localhost/x")).toEqual({ ok: false });
  });
});

describe("upload ids", () => {
  it("never names another photo's thumbnail, poster or proof", () => {
    for (const id of ["abcdefghij-thumb", "abcdefghij-poster", "abcdefghij-proof", "abcdefghij-THUMB"]) {
      expect(isReservedMediaId(id)).toBe(true);
      expect(uploadMediaId.safeParse(id).success).toBe(false);
    }
    expect(uploadMediaId.safeParse("V1StGXR8_Z5jdHi6B-myT").success).toBe(true);
    expect(uploadMediaId.safeParse("abcdefghij-thumbs").success).toBe(true);
  });
});

describe("MED-10 who gets the clean photo", () => {
  const locked = { proofBy: "photographer", proofOriginalPathname: "events/e/m.jpg", proofReleasedAt: null };

  it("is the photographer alone while the proof is locked", () => {
    expect(isLockedProof(locked)).toBe(true);
    expect(cleanOriginalFor(locked, "photographer")).toBe("events/e/m.jpg");
    expect(cleanOriginalFor(locked, "owner")).toBeNull();
    expect(cleanOriginalFor(locked, null)).toBeNull();
  });

  it("is nobody in particular once released, because the row serves it to everyone", () => {
    const released = { ...locked, proofOriginalPathname: null, proofReleasedAt: new Date() };
    expect(isLockedProof(released)).toBe(false);
    expect(cleanOriginalFor(released, "photographer")).toBeNull();
  });
});

describe("MED-10 stamping", () => {
  it("lays the stamp where the layout says and leaves the rest of the photo alone", async () => {
    const photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 40, g: 40, b: 40 } } })
      .jpeg()
      .toBuffer();
    const stampData = await sharp({ create: { width: 200, height: 50, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();

    const result = await watermarkPhoto(photo, { data: stampData, width: 200, height: 50 }, { position: "bottom-right", opacity: 0.8, scale: 0.3 });
    expect([result.width, result.height]).toEqual([600, 400]);

    const { data, info } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
    const brightness = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    // Inside the stamp (bottom right, 180 wide, a 12 pixel margin): near white at 80%.
    expect(brightness(500, 370)).toBeGreaterThan(180);
    // Top left, untouched.
    expect(brightness(20, 20)).toBeLessThan(60);
  });
});
