import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { stripJpegLocation } from "./exif-scrub";

/** The GPS directory's entry count, read independently of the scrubber. */
function gpsEntries(exif: Buffer): number {
  const tiff = 6;
  const little = exif.toString("latin1", tiff, tiff + 2) === "II";
  const u16 = (at: number) => (little ? exif.readUInt16LE(at) : exif.readUInt16BE(at));
  const u32 = (at: number) => (little ? exif.readUInt32LE(at) : exif.readUInt32BE(at));
  const ifd0 = tiff + u32(tiff + 4);
  for (let index = 0; index < u16(ifd0); index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (u16(entry) === 0x8825) return u16(tiff + u32(entry + 8));
  }
  return -1;
}

async function cameraPhoto(options: { xmp?: string } = {}) {
  let image = sharp({ create: { width: 64, height: 48, channels: 3, background: "#888" } }).withExif({
    IFD0: { Make: "Canon", Model: "EOS R5", Copyright: "Jo Lens" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" },
  });
  if (options.xmp) image = image.withXmp(options.xmp);
  return image.jpeg().toBuffer();
}

describe("MED-8 keeping camera details without the location", () => {
  it("empties the GPS directory and keeps the camera, the copyright and the picture", async () => {
    const original = await cameraPhoto();
    const before = await sharp(original).metadata();
    expect(gpsEntries(before.exif!)).toBeGreaterThan(0);

    const result = stripJpegLocation(original)!;
    expect(result.removedGps).toBe(true);
    expect(result.data.length).toBe(original.length);

    const after = await sharp(result.data).metadata();
    expect(gpsEntries(after.exif!)).toBe(0);
    const text = after.exif!.toString("latin1");
    expect(text).toContain("Canon");
    expect(text).toContain("EOS R5");
    expect(text).toContain("Jo Lens");
    expect([after.width, after.height]).toEqual([64, 48]);
    // The latitude's 40/1 rational is gone from the bytes, not only unlinked.
    expect(result.data.includes(Buffer.from([0x28, 0, 0, 0, 1, 0, 0, 0]))).toBe(false);
  });

  it("blanks XMP that carries a location and leaves other XMP alone", async () => {
    const located = await cameraPhoto({
      xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="40,26.7N"/></rdf:RDF></x:xmpmeta>',
    });
    const scrubbed = stripJpegLocation(located)!;
    expect(scrubbed.blankedXmp).toBe(true);
    expect(scrubbed.data.toString("latin1")).not.toContain("GPSLatitude");

    const credited = await cameraPhoto({
      xmp: '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Jo Lens"/></rdf:RDF></x:xmpmeta>',
    });
    expect(stripJpegLocation(credited)!.blankedXmp).toBe(false);
  });

  it("refuses what it cannot walk, so the caller re-encodes instead", async () => {
    expect(stripJpegLocation(Buffer.from("not a jpeg"))).toBeNull();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    expect(stripJpegLocation(png)).toBeNull();
    const truncated = (await cameraPhoto()).subarray(0, 40);
    expect(stripJpegLocation(truncated)).toBeNull();
  });

  it("passes a photo with no location through unchanged", async () => {
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const result = stripJpegLocation(plain)!;
    expect(result.removedGps).toBe(false);
    expect(result.data.equals(plain)).toBe(true);
  });
});
