/**
 * MED-8, the video half: finding where a phone wrote its location into an MP4
 * or QuickTime file, so it can be removed without re-encoding anything.
 *
 * Photos are re-encoded on upload, which drops their EXIF. Videos never were,
 * so every video a guest shared carried the GPS position it was filmed at:
 *
 * - iPhone writes `com.apple.quicktime.location.ISO6709` (and an accuracy key)
 *   into `moov/meta`, a keys list plus an item list indexed into it.
 * - Android and most others write a `©xyz` atom into `moov/udta`, and some a
 *   3GPP `loci` box.
 * - Anything edited in a desktop tool may carry XMP, with `exif:GPSLatitude`.
 *
 * Each of those is **neutralised in place**: its four-character type becomes
 * `free`, which every MP4 reader skips by definition, and its payload is zeroed.
 * Nothing changes size and no offset moves, so the sample tables still point at
 * the right bytes and the video plays exactly as before. That is the whole
 * reason this is a patch and not a remux: a remux needs ffmpeg, and ffmpeg is
 * what OPS-1 is waiting on.
 *
 * Pure: it reads byte ranges through a callback and returns patches. Fetching
 * and rewriting the object is `lib/job-handlers/video-scrub.ts`.
 */

export interface Patch {
  /** Absolute byte offset in the file. */
  offset: number;
  bytes: Buffer;
}

export interface ScrubPlan {
  /** False for anything that is not an ISO base media file. */
  recognised: boolean;
  patches: Patch[];
  /** What was found, for the log. Never the coordinates themselves. */
  removed: string[];
  /**
   * iPhone's own local capture time, as `YYYY-MM-DDTHH:MM:SS` wall time: the
   * same zone-less shape `media.captured_at` holds for photos.
   */
  capturedAt: string | null;
}

export type ReadRange = (offset: number, length: number) => Promise<Buffer>;

/** Boxes holding metadata are small; one this size is something else. */
export const MAX_METADATA_BOX_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 2000;

const XMP_UUID = Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex");
const FREE = Buffer.from("free", "latin1");

interface Box {
  type: string;
  /** Absolute offset of the box's first byte. */
  start: number;
  /** Header length: 8, or 16 with a 64-bit size. */
  header: number;
  /** Absolute offset one past the last byte. */
  end: number;
}

function isFourCC(bytes: Buffer): boolean {
  // Printable ASCII, plus 0xA9 for Apple's "©" atoms.
  for (const byte of bytes) if (!((byte >= 0x20 && byte <= 0x7e) || byte === 0xa9)) return false;
  return true;
}

/**
 * The box starting at `at` within `buffer` (whose first byte sits at absolute
 * `base`), or null if what is there cannot be a box inside `limit`.
 */
function readBox(buffer: Buffer, at: number, base: number, limit: number): Box | null {
  if (at + 8 > buffer.length) return null;
  let size = buffer.readUInt32BE(at);
  const typeBytes = buffer.subarray(at + 4, at + 8);
  let header = 8;
  if (size === 1) {
    if (at + 16 > buffer.length) return null;
    const large = buffer.readBigUInt64BE(at + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    header = 16;
  } else if (size === 0) {
    size = limit - (base + at);
  }
  if (size < header || base + at + size > limit) return null;
  return { type: typeBytes.toString("latin1"), start: base + at, header, end: base + at + size };
}

/**
 * Children of a container whose payload is `buffer[from, to)`. An item list's
 * children are typed by a binary key index rather than four printable
 * characters, so that check is skipped for them.
 */
function children(buffer: Buffer, base: number, from: number, to: number, printableTypes = true): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const box = readBox(buffer, at, base, base + to);
    if (!box || (printableTypes && !isFourCC(buffer.subarray(at + 4, at + 8)))) break;
    found.push(box);
    at = box.end - base;
  }
  return found;
}

function neutralise(box: Box): Patch[] {
  return [
    { offset: box.start + 4, bytes: FREE },
    { offset: box.start + box.header, bytes: Buffer.alloc(box.end - box.start - box.header) },
  ];
}

const isLocationKey = (key: string) => /location|\.gps|iso6709/i.test(key);

function hasXmpLocation(payload: Buffer): boolean {
  return /GPS(Latitude|Longitude|Altitude|Coordinates)|iso6709/i.test(payload.toString("latin1"));
}

/** `2023-07-15T14:03:12+0200` (or with a colon in the offset) as wall time. */
export function quicktimeWallTime(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(value.trim());
  return match ? `${match[1]}T${match[2]}` : null;
}

/**
 * Walks one metadata box already in memory (`moov`, or a top-level XMP `uuid`)
 * and plans the patches that remove location from it.
 */
export function planMetadataBox(buffer: Buffer, base: number): Omit<ScrubPlan, "recognised"> {
  const patches: Patch[] = [];
  const removed: string[] = [];
  let capturedAt: string | null = null;
  const limit = base + buffer.length;

  const visit = (box: Box, depth: number) => {
    if (depth > 12) return;
    const local = box.start - base;
    const payloadFrom = local + box.header;
    const payloadTo = box.end - base;

    switch (box.type) {
      case "moov":
      case "trak":
      case "udta":
      case "mdia":
      case "minf": {
        for (const child of children(buffer, base, payloadFrom, payloadTo)) visit(child, depth + 1);
        return;
      }
      case "meta": {
        // ISO `meta` is a full box with four bytes of version and flags before
        // its children; QuickTime's is not. Its first child is always `hdlr`.
        const quicktime = buffer.subarray(payloadFrom + 4, payloadFrom + 8).toString("latin1") === "hdlr";
        const kids = children(buffer, base, quicktime ? payloadFrom : payloadFrom + 4, payloadTo);
        const keysBox = kids.find((kid) => kid.type === "keys");
        const keyNames = keysBox ? readKeys(buffer, base, keysBox) : [];
        for (const kid of kids) {
          if (kid.type === "ilst") {
            visitItemList(kid, keyNames);
          } else {
            visit(kid, depth + 1);
          }
        }
        return;
      }
      case "©xyz":
      case "loci":
        patches.push(...neutralise(box));
        removed.push(box.type === "loci" ? "loci" : "xyz");
        return;
      case "XMP_":
        if (hasXmpLocation(buffer.subarray(payloadFrom, payloadTo))) {
          patches.push(...neutralise(box));
          removed.push("xmp");
        }
        return;
      case "uuid":
        if (
          buffer.subarray(payloadFrom, payloadFrom + 16).equals(XMP_UUID) &&
          hasXmpLocation(buffer.subarray(payloadFrom + 16, payloadTo))
        ) {
          patches.push(...neutralise(box));
          removed.push("xmp");
        }
        return;
      default:
        return;
    }
  };

  const visitItemList = (list: Box, keyNames: string[]) => {
    for (const item of children(buffer, base, list.start - base + list.header, list.end - base, false)) {
      const raw = buffer.readUInt32BE(item.start - base + 4);
      // QuickTime items are typed by a 1-based index into `keys`; iTunes-style
      // ones by a four-character code.
      const name = raw >= 1 && raw <= keyNames.length ? keyNames[raw - 1] : item.type;
      if (name === "©xyz" || isLocationKey(name)) {
        patches.push(...neutralise(item));
        removed.push(name === "©xyz" ? "xyz" : "apple-location");
      } else if (name === "com.apple.quicktime.creationdate" && !capturedAt) {
        const value = readDataValue(buffer, base, item);
        capturedAt = value ? quicktimeWallTime(value) : null;
      }
    }
  };

  const top = readBox(buffer, 0, base, limit);
  if (top) visit(top, 0);
  return { patches, removed, capturedAt };
}

/** The key names in a QuickTime `keys` box, in index order. */
function readKeys(buffer: Buffer, base: number, box: Box): string[] {
  const names: string[] = [];
  let at = box.start - base + box.header + 4; // version and flags
  if (at + 4 > box.end - base) return names;
  const count = buffer.readUInt32BE(at);
  at += 4;
  for (let index = 0; index < count && at + 8 <= box.end - base; index += 1) {
    const size = buffer.readUInt32BE(at);
    if (size < 8 || at + size > box.end - base) break;
    names.push(buffer.subarray(at + 8, at + size).toString("utf8"));
    at += size;
  }
  return names;
}

/** The UTF-8 value of the first `data` atom in an item list entry. */
function readDataValue(buffer: Buffer, base: number, item: Box): string | null {
  const data = children(buffer, base, item.start - base + item.header, item.end - base).find((kid) => kid.type === "data");
  if (!data) return null;
  // type indicator (4) and locale (4) precede the value.
  const from = data.start - base + data.header + 8;
  return from <= data.end - base ? buffer.subarray(from, data.end - base).toString("utf8") : null;
}

/**
 * Plans the scrub of a whole file by reading only its box headers and its
 * metadata boxes, never `mdat`, which is nearly all of the file.
 */
export async function planVideoScrub(size: number, read: ReadRange): Promise<ScrubPlan> {
  const plan: ScrubPlan = { recognised: false, patches: [], removed: [], capturedAt: null };
  let offset = 0;
  for (let count = 0; offset + 8 <= size && count < MAX_TOP_LEVEL_BOXES; count += 1) {
    const head = await read(offset, Math.min(16, size - offset));
    if (!isFourCC(head.subarray(4, 8))) break;
    const box = readBox(head, 0, offset, size);
    if (!box) break;
    if (count === 0 && !["ftyp", "wide", "free", "skip", "mdat", "moov", "pnot"].includes(box.type)) break;
    plan.recognised = true;

    const wanted =
      box.type === "moov" ||
      (box.type === "uuid" && box.end - box.start <= MAX_METADATA_BOX_BYTES);
    if (wanted) {
      if (box.end - box.start > MAX_METADATA_BOX_BYTES) {
        throw new Error(`moov box of ${box.end - box.start} bytes is past the metadata limit`);
      }
      const bytes = await read(box.start, box.end - box.start);
      const found = planMetadataBox(bytes, box.start);
      plan.patches.push(...found.patches);
      plan.removed.push(...found.removed);
      plan.capturedAt ??= found.capturedAt;
    }
    offset = box.end;
  }
  return plan;
}

/** Applies patches to one chunk of the file that starts at absolute `at`. */
export function applyPatches(chunk: Buffer, at: number, patches: Patch[]): Buffer {
  let out = chunk;
  for (const patch of patches) {
    const from = Math.max(patch.offset, at);
    const to = Math.min(patch.offset + patch.bytes.length, at + chunk.length);
    if (from >= to) continue;
    if (out === chunk) out = Buffer.from(chunk);
    patch.bytes.copy(out, from - at, from - patch.offset, to - patch.offset);
  }
  return out;
}
