/**
 * Magic-byte validation for uploaded media.
 *
 * Why this is needed even though the mime allowlist exists: the allowlist runs
 * against what the *client says* the file is. Verified against the live bucket,
 * R2 signs `Content-Type` but does not enforce it, so a URL presigned for
 * `image/jpeg` will happily accept a ZIP. Declared type is a label; this reads
 * the bytes.
 *
 * Only what a photo gallery can actually display is accepted. Anything else is
 * storage someone else is paying for.
 */

export type MediaFamily = "image" | "video";

export interface SignatureMatch {
  family: MediaFamily;
  /** Canonical label for the detected format, for error messages and logging. */
  format: string;
}

/** ISO base media brands (the 4 bytes after "ftyp") we accept as video. */
const VIDEO_FTYP_BRANDS = [
  "isom", "iso2", "iso4", "iso5", "iso6", "avc1", "mp41", "mp42", "mp4v",
  "qt  ", "M4V ", "M4VH", "M4VP", "mmp4", "dash",
];

/** The same box, but brands that mean "still image" rather than "movie". */
const IMAGE_FTYP_BRANDS = [
  "heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "hevx",
  "mif1", "msf1", "avif", "avis",
];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Identifies a file from its leading bytes. 32 bytes is enough for every format
 * here; `ftyp` brands sit at offset 8 and nothing else reaches further.
 *
 * Returns null when the bytes match nothing we serve, which is the signal to
 * reject the upload rather than to guess.
 */
export function detectMediaSignature(bytes: Uint8Array): SignatureMatch | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { family: "image", format: "jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { family: "image", format: "png" };
  }
  // Matroska and WebM share the EBML header; WebM is the subset browsers record.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { family: "video", format: "webm" };

  // RIFF containers: bytes 8-12 say which kind. Only WEBP is an image.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { family: "image", format: "webp" };
  }

  // ISO base media: "ftyp" at offset 4, brand at offset 8. Covers MP4, QuickTime
  // (iPhone .mov), HEIC and AVIF, which is why brand matters more than extension.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (IMAGE_FTYP_BRANDS.includes(brand)) return { family: "image", format: `heif:${brand}` };
    if (VIDEO_FTYP_BRANDS.includes(brand)) return { family: "video", format: `mp4:${brand}` };
    // An unrecognised brand is still an ISO container. Phone vendors invent
    // brands, and rejecting a guest's genuine recording is worse than accepting
    // a container we could not name precisely, so treat it as video.
    return { family: "video", format: `iso:${brand}` };
  }

  return null;
}

/** How many leading bytes `detectMediaSignature` needs. */
export const SIGNATURE_BYTES = 32;
