/**
 * MED-8, for professionals: remove where a JPEG was taken and keep the rest of
 * what the camera wrote (make, model, lens, exposure, copyright, the time).
 * Used only when a host has turned on "keep camera details" and only for the
 * team's own uploads; every other photo is re-encoded, which drops it all.
 *
 * In place, as lib/video-metadata.ts does for video: nothing moves and the
 * image data is never decoded, so the photo is byte-for-byte the original
 * apart from the zeroed location.
 *
 * - **The EXIF GPS block.** IFD0's GPSInfo pointer (tag 0x8825) leads to a
 *   directory of latitude, longitude, altitude and the rest. Every value it
 *   points at is zeroed, every entry is zeroed, and its count is set to 0, so
 *   a reader finds an empty GPS directory where the location was.
 * - **XMP that mentions location.** XMP can carry exif:GPSLatitude and the
 *   like. A packet that mentions GPS or location is blanked to spaces, which
 *   every XMP reader treats as empty.
 *
 * Returns null for anything it cannot walk with confidence, and the caller
 * then falls back to re-encoding, which removes everything. Never a partial
 * scrub passed off as a whole one.
 */

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

export type LocationScrub = { data: Buffer; removedGps: boolean; blankedXmp: boolean };

export function stripJpegLocation(input: Uint8Array): LocationScrub | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const data = Buffer.from(input);
  let removedGps = false;
  let blankedXmp = false;

  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // The image data starts here; every metadata segment comes before it.
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;
    const payload = offset + 4;
    const end = offset + 2 + length;

    if (marker === 0xe1) {
      if (data.toString("latin1", payload, payload + 6) === "Exif\0\0") {
        const scrubbed = scrubExif(data, payload + 6, end);
        if (scrubbed === null) return null;
        removedGps ||= scrubbed;
      } else if (data.toString("latin1", payload, payload + XMP_HEADER.length) === XMP_HEADER) {
        const start = payload + XMP_HEADER.length;
        if (/gps|location/i.test(data.toString("latin1", start, end))) {
          data.fill(0x20, start, end);
          blankedXmp = true;
        }
      }
    }
    offset = end;
  }
  return { data, removedGps, blankedXmp };
}

/** Empties the GPS directory of one EXIF block. True if there was one, null if malformed. */
function scrubExif(data: Buffer, tiff: number, segmentEnd: number): boolean | null {
  if (tiff + 8 > segmentEnd) return null;
  const order = data.toString("latin1", tiff, tiff + 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const u16 = (at: number) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
  const u32 = (at: number) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
  if (u16(tiff + 2) !== 42) return null;

  const inside = (start: number, size: number) => start >= tiff && start + size <= segmentEnd;
  const ifd0 = tiff + u32(tiff + 4);
  if (!inside(ifd0, 2)) return null;
  const count0 = u16(ifd0);
  if (count0 > 512 || !inside(ifd0 + 2, count0 * 12)) return null;

  for (let index = 0; index < count0; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (u16(entry) !== 0x8825) continue;
    const gps = tiff + u32(entry + 8);
    if (!inside(gps, 2)) return null;
    const gpsCount = u16(gps);
    if (gpsCount > 128 || !inside(gps + 2, gpsCount * 12)) return null;
    for (let gpsIndex = 0; gpsIndex < gpsCount; gpsIndex += 1) {
      const gpsEntry = gps + 2 + gpsIndex * 12;
      const size = (TYPE_SIZES[u16(gpsEntry + 2)] ?? 1) * u32(gpsEntry + 4);
      if (size > 4) {
        const valueAt = tiff + u32(gpsEntry + 8);
        if (!inside(valueAt, size)) return null;
        data.fill(0, valueAt, valueAt + size);
      }
      data.fill(0, gpsEntry, gpsEntry + 12);
    }
    // An empty directory where the location was.
    if (little) data.writeUInt16LE(0, gps);
    else data.writeUInt16BE(0, gps);
    return true;
  }
  return false;
}
