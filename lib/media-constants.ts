/** Shared between the client-side compressor and the server-side fallback so
 * both paths produce comparable output. */
export const COMPRESS_MAX_DIMENSION = 2560;
export const COMPRESS_QUALITY = 80;

/**
 * MIME types may carry parameters: MediaRecorder reports its output as
 * "video/mp4;codecs=vp9,opus". Allowlist checks and video detection must
 * compare the essence only, or valid recordings get rejected.
 * Lives here rather than in storage.ts so the camera can share it without
 * pulling the S3 client into the browser bundle.
 */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * How many photos one request to /api/events/[id]/media/bulk may name. The
 * dashboard sends a bigger selection ("Select all" on a big wedding) in
 * batches of this size.
 */
export const MEDIA_BULK_LIMIT = 500;
