/**
 * Reads one thing out of a photo: when it was taken.
 *
 * Everything else in the upload pipeline is trying to *remove* metadata.
 * `sharp` strips EXIF by default and the browser's canvas re-encode in
 * `lib/image-compress.ts` does the same, which is what we want: a camera JPEG
 * carries GPS coordinates, a device serial number and often the owner's name,
 * and none of that belongs in a shared gallery.
 *
 * The casualty of that is the capture time. `media.created_at` records when a
 * file reached us, which can be days after the event, and AI-1 groups photos
 * into moments by when they were actually shot. So this reads the one field
 * worth keeping, before the stripping happens, and nothing else.
 *
 * It is deliberately a parser rather than a dependency. The same code has to
 * run on the server (over a Buffer pulled back from R2) and in the browser
 * (over the original File, before compression discards it), and a hand-written
 * reader for a single tag is smaller than the two libraries that would
 * otherwise be needed.
 *
 * **Known limitation: HEIC.** iPhones shoot HEIC by default, and its metadata
 * lives in an ISO base media container rather than a JPEG APP1 segment. This
 * reader returns null for those, and `heic-convert` does not carry EXIF across
 * when it converts to JPEG, so iPhone photos keep falling back to upload time
 * until OPS-1 puts a real decoder in the pipeline.
 */

/** EXIF tag 0x9003. The camera's own clock at the moment of exposure. */
const TAG_DATE_TIME_ORIGINAL = 0x9003;
/** EXIF tag 0x0132, on IFD0. Last modification, used only as a fallback. */
const TAG_DATE_TIME = 0x0132;
/** EXIF tag 0x8769. Offset to the sub-IFD where the interesting tags live. */
const TAG_EXIF_IFD_POINTER = 0x8769;

/** EXIF type 2: a NUL-terminated ASCII string, one byte per component. */
const TYPE_ASCII = 2;
/** EXIF type 4: unsigned long, four bytes. Used by the sub-IFD pointer. */
const TYPE_LONG = 4;

/**
 * Where the TIFF header starts, given whatever the caller handed us. Three
 * shapes turn up in practice: a whole JPEG file, the raw EXIF block that
 * `sharp().metadata()` returns (which keeps its "Exif\0\0" prefix), and a bare
 * TIFF block. Returning an offset rather than a slice keeps every later read
 * relative to the TIFF origin, which is what the format's own offsets assume.
 */
function findTiffStart(bytes: Uint8Array): number | null {
  // Bare "Exif\0\0" header, as handed over by sharp.
  if (
    bytes.length > 6 &&
    bytes[0] === 0x45 &&
    bytes[1] === 0x78 &&
    bytes[2] === 0x69 &&
    bytes[3] === 0x66 &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x00
  ) {
    return 6;
  }

  // A bare TIFF block: "II" little endian or "MM" big endian.
  if (
    bytes.length > 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d))
  ) {
    return 0;
  }

  // A whole JPEG. Walk the segment markers looking for APP1.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];

    // Padding and standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan means the entropy-coded image data begins, and any
    // remaining bytes are no longer segments. Stop rather than misread them.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;

    if (marker === 0xe1) {
      const payload = offset + 4;
      if (
        payload + 6 <= bytes.length &&
        bytes[payload] === 0x45 &&
        bytes[payload + 1] === 0x78 &&
        bytes[payload + 2] === 0x69 &&
        bytes[payload + 3] === 0x66 &&
        bytes[payload + 4] === 0x00 &&
        bytes[payload + 5] === 0x00
      ) {
        return payload + 6;
      }
    }

    offset += 2 + length;
  }

  return null;
}

interface Reader {
  view: DataView;
  tiff: number;
  little: boolean;
}

/**
 * Reads an ASCII tag value. Values of four bytes or fewer are stored inline in
 * the entry's value field; anything longer, which includes every timestamp,
 * is stored elsewhere in the block and the field holds an offset from the TIFF
 * origin. Both cases have to be handled or long values read as garbage.
 */
function readAscii(reader: Reader, entry: number, count: number): string | null {
  const { view, tiff, little } = reader;
  const start = count <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little);
  if (start < 0 || start + count > view.byteLength) return null;

  let out = "";
  for (let index = 0; index < count; index += 1) {
    const code = view.getUint8(start + index);
    if (code === 0) break;
    // Anything outside printable ASCII means we are not reading a string.
    if (code < 0x20 || code > 0x7e) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Walks one image file directory, calling back for each entry. Bounded by an
 * explicit entry count and a byte-length check, because the offsets in this
 * structure come from a file a stranger uploaded and a malformed one must
 * fail rather than loop.
 */
function eachEntry(
  reader: Reader,
  directory: number,
  visit: (tag: number, type: number, count: number, entry: number) => void,
): void {
  const { view, little } = reader;
  if (directory + 2 > view.byteLength) return;

  const entries = view.getUint16(directory, little);
  // A real IFD has a handful of entries. A four-figure count means the offset
  // was wrong and we are reading image data as a directory.
  if (entries > 512) return;

  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > view.byteLength) return;
    visit(
      view.getUint16(entry, little),
      view.getUint16(entry + 2, little),
      view.getUint32(entry + 4, little),
      entry,
    );
  }
}

/**
 * EXIF writes timestamps as "YYYY:MM:DD HH:MM:SS" with no timezone at all.
 *
 * That missing zone is the reason the value is stored as a zone-less wall
 * clock rather than converted to an instant. Guessing a zone would be worse
 * than keeping what the camera said: the photos being grouped were taken by
 * people standing in the same room, so their cameras agree with each other
 * even when none of them agrees with UTC.
 *
 * Cameras also emit "0000:00:00 00:00:00" and a run of spaces when the field
 * is present but unset, so a shape check is not enough on its own.
 */
function normalizeExifTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);

  if (y < 1900 || y > 2200) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || s > 60) return null;

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Returns the capture time as a zone-less wall clock, "2026-09-30T18:45:12",
 * or null when the file does not carry one.
 *
 * Never throws. A malformed or hostile file is an expected input here, and the
 * caller's decision does not change when parsing fails: store nothing and fall
 * back to upload time.
 */
export function readCaptureTime(bytes: Uint8Array): string | null {
  try {
    const tiff = findTiffStart(bytes);
    if (tiff === null || tiff + 8 > bytes.length) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endian = view.getUint16(tiff, false);
    if (endian !== 0x4949 && endian !== 0x4d4d) return null;
    const little = endian === 0x4949;

    // The 42 is the format's own magic number and a cheap way to confirm the
    // endianness guess was right before trusting any offset that follows.
    if (view.getUint16(tiff + 2, little) !== 42) return null;

    const reader: Reader = { view, tiff, little };
    const ifd0 = tiff + view.getUint32(tiff + 4, little);
    if (ifd0 + 2 > view.byteLength) return null;

    let exifIfd: number | null = null;
    let fallback: string | null = null;

    eachEntry(reader, ifd0, (tag, type, count, entry) => {
      if (tag === TAG_EXIF_IFD_POINTER && type === TYPE_LONG) {
        exifIfd = tiff + view.getUint32(entry + 8, little);
      } else if (tag === TAG_DATE_TIME && type === TYPE_ASCII) {
        fallback = readAscii(reader, entry, count);
      }
    });

    let original: string | null = null;
    if (exifIfd !== null && exifIfd + 2 <= view.byteLength) {
      eachEntry(reader, exifIfd, (tag, type, count, entry) => {
        if (tag === TAG_DATE_TIME_ORIGINAL && type === TYPE_ASCII) {
          original = readAscii(reader, entry, count);
        }
      });
    }

    // DateTimeOriginal is the exposure. DateTime on IFD0 is whenever the file
    // was last written, so an edit in any photo app overwrites it. Prefer the
    // first and accept the second only when there is nothing better.
    return normalizeExifTimestamp(original) ?? normalizeExifTimestamp(fallback);
  } catch {
    return null;
  }
}

/**
 * How much of a file to read when looking for its capture time.
 *
 * EXIF sits in the first APP1 segment, immediately after the start-of-image
 * marker, and the segment is capped at 64 KB by the JPEG format itself. Double
 * that is comfortably enough, and it matters because the alternative is
 * pulling a 25 MB photo into memory on a phone to read twenty bytes from the
 * front of it.
 */
const CAPTURE_TIME_SCAN_BYTES = 128 * 1024;

/**
 * Browser-side companion to `readCaptureTime`: reads the capture time off the
 * original file before compression re-encodes it away.
 *
 * This has to happen on the client for most photos. `compressImageForUpload`
 * draws the image to a canvas, and a canvas has no way to carry metadata
 * across, so by the time the bytes reach the server the timestamp is already
 * gone. Never throws; an unreadable file simply has no capture time.
 */
export async function readCaptureTimeFromFile(file: Blob): Promise<string | null> {
  try {
    const head = file.slice(0, CAPTURE_TIME_SCAN_BYTES);
    return readCaptureTime(new Uint8Array(await head.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Guards a capture time that arrived over the wire.
 *
 * The browser reads EXIF before compression destroys it, so for most photos
 * this value is client-supplied. It is descriptive metadata rather than a
 * security boundary, but an unchecked string still ends up in a timestamp
 * column and in AI-1's clustering, so the range is bounded: nothing before
 * digital cameras existed, and nothing meaningfully in the future, which is
 * what a device with a wrong clock produces.
 */
export function isPlausibleCaptureTime(value: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}Z`);
  if (Number.isNaN(parsed)) return false;

  const earliest = Date.UTC(1990, 0, 1);
  // Two days of slack absorbs a camera set to the wrong side of the date line
  // without accepting a timestamp that is simply wrong.
  const latest = now.getTime() + 2 * 24 * 60 * 60 * 1000;
  return parsed >= earliest && parsed <= latest;
}
