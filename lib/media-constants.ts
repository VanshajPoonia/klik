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
