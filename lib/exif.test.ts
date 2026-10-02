import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isPlausibleCaptureTime, readCaptureTime, readCaptureTimeFromFile } from "./exif";

/**
 * Fixtures are generated rather than committed. A checked-in binary nobody can
 * read is a bad way to express "a JPEG whose DateTimeOriginal says X", and
 * `sharp` is already a dependency, so the intent can be written out in the
 * test itself.
 */
const canvas = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: "#4a6" } });

const photoTakenAt = (original: string, extra: Record<string, unknown> = {}) =>
  canvas()
    .withExif({ IFD0: { Make: "Klik", Model: "TestCam" }, IFD2: { DateTimeOriginal: original }, ...extra })
    .jpeg()
    .toBuffer();

/** The exact pipeline app/api/e/[slug]/media/route.ts runs before storing. */
const asStored = (input: Buffer) =>
  sharp(input)
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

describe("readCaptureTime", () => {
  it("reads DateTimeOriginal out of a real JPEG", async () => {
    expect(readCaptureTime(await photoTakenAt("2026:09:30 18:45:12"))).toBe("2026-09-30T18:45:12");
  });

  it("parses the raw exif block sharp hands back, not just whole files", async () => {
    const { exif } = await sharp(await photoTakenAt("2026:09:30 18:45:12")).metadata();
    expect(exif).toBeDefined();
    expect(readCaptureTime(new Uint8Array(exif!))).toBe("2026-09-30T18:45:12");
  });

  it("falls back to IFD0 DateTime when there is no DateTimeOriginal", async () => {
    const jpeg = await canvas().withExif({ IFD0: { DateTime: "2020:05:06 07:08:09" } }).jpeg().toBuffer();
    expect(readCaptureTime(jpeg)).toBe("2020-05-06T07:08:09");
  });

  it("prefers DateTimeOriginal over IFD0 DateTime, which any edit overwrites", async () => {
    const jpeg = await canvas()
      .withExif({ IFD0: { DateTime: "2020:01:01 00:00:00" }, IFD2: { DateTimeOriginal: "2026:09:30 18:45:12" } })
      .jpeg()
      .toBuffer();
    expect(readCaptureTime(jpeg)).toBe("2026-09-30T18:45:12");
  });

  // Cameras write the field but leave it blank or zeroed. A shape check alone
  // would happily turn these into a timestamp AI-1 then clusters on.
  it.each(["0000:00:00 00:00:00", "    :  :     :  :  ", "2026:13:45 99:99:99"])(
    "rejects the unset camera field %j",
    async (raw) => {
      expect(readCaptureTime(await photoTakenAt(raw))).toBeNull();
    },
  );

  // Every one of these is a file a stranger can upload, so the contract is
  // "returns null", never "throws".
  it("returns null without throwing for anything that is not a photo with exif", async () => {
    const withExif = await photoTakenAt("2026:09:30 18:45:12");
    const cases: Array<[string, Uint8Array]> = [
      ["empty", new Uint8Array(0)],
      ["a zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])],
      ["a jpeg with no exif", new Uint8Array(await canvas().jpeg().toBuffer())],
      ["a truncated exif block", withExif.subarray(0, 24)],
      ["a png", new Uint8Array(await canvas().png().toBuffer())],
      ["a header that claims exif then lies", new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0xff])],
    ];
    for (const [name, bytes] of cases) {
      expect(() => readCaptureTime(bytes), name).not.toThrow();
      expect(readCaptureTime(bytes), name).toBeNull();
    }
  });
});

describe("the stored file", () => {
  /**
   * This is MED-8's actual claim, and it was wrong in the roadmap for a while.
   * sharp strips metadata unless `.withMetadata()` is called, and nothing in
   * the upload path calls it, so photos were already clean. Pinned here so the
   * day someone adds `.withMetadata()` for orientation reasons, this fails.
   */
  it("carries no exif at all after the pipeline runs", async () => {
    const stored = await asStored(await photoTakenAt("2026:09:30 18:45:12", { IFD3: { GPSLatitudeRef: "N" } }));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(readCaptureTime(stored)).toBeNull();
  });

  it("can still be decoded leniently when the strict pass refuses it", async () => {
    // A file cut off mid-scan, which is what a dropped upload over venue wifi
    // produces. sanitizePhoto's second attempt exists for exactly this, so if
    // the two passes ever stop differing the retry is dead code.
    const good = await photoTakenAt("2026:09:30 18:45:12");
    const truncated = good.subarray(0, Math.floor(good.length * 0.6));
    const resize = { width: 2560, height: 2560, fit: "inside" as const, withoutEnlargement: true };

    await expect(
      sharp(truncated).rotate().resize(resize).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
    ).rejects.toThrow();

    await expect(
      sharp(truncated, { failOn: "none" }).rotate().resize(resize).jpeg({ quality: 82 }).toBuffer(),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

describe("readCaptureTimeFromFile", () => {
  it("reads the capture time without pulling the whole file into memory", async () => {
    const jpeg = await photoTakenAt("2026:09:30 18:45:12");
    expect(await readCaptureTimeFromFile(new Blob([new Uint8Array(jpeg)]))).toBe("2026-09-30T18:45:12");
  });

  it("returns null rather than throwing on an unreadable blob", async () => {
    expect(await readCaptureTimeFromFile(new Blob([new Uint8Array([1, 2, 3])]))).toBeNull();
  });
});

describe("isPlausibleCaptureTime", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("accepts a normal timestamp", () => {
    expect(isPlausibleCaptureTime("2026-09-30T18:45:12", now)).toBe(true);
  });

  // A device with a wrong clock, and a client that simply made something up,
  // look identical from here. Both are rejected on range.
  it.each([
    ["far future", "2099-01-01T00:00:00"],
    ["before digital cameras", "1980-01-01T00:00:00"],
    ["not a timestamp", "nope"],
    ["an instant with a zone, which exif never has", "2026-09-30T18:45:12Z"],
  ])("rejects %s", (_label, value) => {
    expect(isPlausibleCaptureTime(value, now)).toBe(false);
  });

  it("allows two days of slack for a camera set across the date line", () => {
    expect(isPlausibleCaptureTime("2026-10-02T12:00:00", now)).toBe(true);
    expect(isPlausibleCaptureTime("2026-10-05T12:00:00", now)).toBe(false);
  });
});
