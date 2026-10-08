/**
 * OPS-2: how a large upload is cut into parts. Shared by the browser, which
 * cuts the file, and the server, which signs one URL per part and checks the
 * pieces add up when the upload completes, so both always agree on the cut.
 *
 * Client-safe: no SDK, no environment.
 */

/** At or below this a file goes up in one request, as it always has. Photos
 *  are capped at 25 MB, so in practice this is video. */
export const MULTIPART_THRESHOLD = 32 * 1024 * 1024;

/**
 * 8 MB: above S3's 5 MB floor for every part but the last, and small enough
 * that a part lost to a wifi drop costs seconds to resend, not minutes.
 */
export const PART_SIZE = 8 * 1024 * 1024;

/** R2 requires every part but the last to be exactly the same size. */
export function partSizes(totalBytes: number, partSize = PART_SIZE): number[] {
  if (totalBytes <= 0) return [];
  const full = Math.floor(totalBytes / partSize);
  const rest = totalBytes - full * partSize;
  return [...Array<number>(full).fill(partSize), ...(rest > 0 ? [rest] : [])];
}
