import { describe, expect, it } from "vitest";
import { applyPatches, planVideoScrub, quicktimeWallTime, type ReadRange } from "./video-metadata";

import { androidMoov, box, ftyp, iphoneMoov, largeBox, mdat, mvhd, text } from "../test/fixtures/video";

function reader(file: Buffer, log: Array<[number, number]> = []): ReadRange {
  return async (offset, length) => {
    log.push([offset, length]);
    return file.subarray(offset, offset + length);
  };
}

async function scrub(file: Buffer) {
  const plan = await planVideoScrub(file.length, reader(file));
  return { plan, out: applyPatches(file, 0, plan.patches) };
}

// --- Tests --------------------------------------------------------------------

describe("planVideoScrub", () => {
  it("removes an Android ©xyz location and changes nothing else", async () => {
    const file = Buffer.concat([ftyp(), mdat(), androidMoov()]);
    const { plan, out } = await scrub(file);
    expect(plan.recognised).toBe(true);
    expect(plan.removed).toEqual(["xyz"]);
    expect(out.length).toBe(file.length);
    expect(out.includes(text("+37.4219"))).toBe(false);
    // Everything outside the atom is byte-for-byte what it was.
    expect(out.subarray(0, file.length - 40).equals(file.subarray(0, file.length - 40))).toBe(true);
    // And scrubbing the result finds nothing left.
    expect((await scrub(out)).plan.patches).toEqual([]);
  });

  it("removes the iPhone location keys, keeps the rest, and reads the capture time", async () => {
    const file = Buffer.concat([
      ftyp(),
      iphoneMoov([
        ["com.apple.quicktime.location.ISO6709", "+51.5007-000.1246+011.000/"],
        ["com.apple.quicktime.location.accuracy.horizontal", "4.7"],
        ["com.apple.quicktime.creationdate", "2023-07-15T14:03:12+0200"],
        ["com.apple.quicktime.make", "Apple"],
      ]),
      mdat(),
    ]);
    const { plan, out } = await scrub(file);
    expect(plan.removed).toEqual(["apple-location", "apple-location"]);
    expect(plan.capturedAt).toBe("2023-07-15T14:03:12");
    expect(out.includes(text("+51.5007"))).toBe(false);
    expect(out.includes(text("Apple"))).toBe(true);
    expect(out.includes(text("2023-07-15T14:03:12"))).toBe(true);
  });

  it("removes XMP that carries GPS, and leaves XMP that does not", async () => {
    const xmpUuid = Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex");
    const withGps = box("uuid", xmpUuid, text("<x:xmpmeta><exif:GPSLatitude>51,30.04N</exif:GPSLatitude></x:xmpmeta>"));
    const without = box("uuid", xmpUuid, text("<x:xmpmeta><dc:title>Toast</dc:title></x:xmpmeta>"));
    const { plan, out } = await scrub(Buffer.concat([ftyp(), withGps, without, mdat(), androidMoov()]));
    expect(plan.removed.sort()).toEqual(["xmp", "xyz"]);
    expect(out.includes(text("GPSLatitude"))).toBe(false);
    expect(out.includes(text("Toast"))).toBe(true);
  });

  it("reads box headers and metadata, never the media data", async () => {
    const big = mdat(2_000_000);
    const file = Buffer.concat([ftyp(), big, androidMoov()]);
    const reads: Array<[number, number]> = [];
    await planVideoScrub(file.length, reader(file, reads));
    const total = reads.reduce((sum, [, length]) => sum + length, 0);
    expect(total).toBeLessThan(1_000);
  });

  it("follows a 64-bit box size", async () => {
    const file = Buffer.concat([ftyp(), largeBox("mdat", Buffer.alloc(5000, 1)), androidMoov()]);
    expect((await scrub(file)).plan.removed).toEqual(["xyz"]);
  });

  it("works whether moov comes before or after the media data", async () => {
    const fastStart = Buffer.concat([ftyp(), androidMoov(), mdat()]);
    expect((await scrub(fastStart)).plan.removed).toEqual(["xyz"]);
  });

  it("does not recognise a WebM, which has no such atoms", async () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]);
    const plan = await planVideoScrub(webm.length, reader(webm));
    expect(plan).toMatchObject({ recognised: false, patches: [] });
  });

  it("finds nothing to do in a file with no location", async () => {
    const file = Buffer.concat([ftyp(), box("moov", mvhd()), mdat()]);
    const plan = await planVideoScrub(file.length, reader(file));
    expect(plan).toMatchObject({ recognised: true, patches: [], removed: [] });
  });
});

describe("applyPatches", () => {
  it("gives the same bytes however the file is chunked", async () => {
    const file = Buffer.concat([ftyp(), mdat(10_000), androidMoov(), iphoneMoov([["com.apple.quicktime.location.ISO6709", "+1.0+2.0/"]])]);
    const plan = await planVideoScrub(file.length, reader(file));
    const whole = applyPatches(file, 0, plan.patches);
    for (const size of [1, 7, 13, 4096]) {
      const pieces: Buffer[] = [];
      for (let at = 0; at < file.length; at += size) {
        pieces.push(applyPatches(file.subarray(at, at + size), at, plan.patches));
      }
      expect(Buffer.concat(pieces).equals(whole)).toBe(true);
    }
  });

  it("leaves a chunk with no patch in it untouched, and uncopied", () => {
    const chunk = Buffer.alloc(16, 1);
    expect(applyPatches(chunk, 1000, [{ offset: 0, bytes: Buffer.alloc(4) }])).toBe(chunk);
  });
});

describe("quicktimeWallTime", () => {
  it("keeps the wall time and drops the offset", () => {
    expect(quicktimeWallTime("2023-07-15T14:03:12+0200")).toBe("2023-07-15T14:03:12");
    expect(quicktimeWallTime("2023-07-15T14:03:12-07:00")).toBe("2023-07-15T14:03:12");
    expect(quicktimeWallTime("July")).toBeNull();
  });
});
