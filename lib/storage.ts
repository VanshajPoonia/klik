import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { baseMimeType } from "./media-constants";
import { env } from "./env";

// klik-media is an EU-jurisdiction bucket, which requires the .eu. endpoint
// instead of R2's default global one, or every request 403s. That is the
// fallback rather than the rule, so the OPS-4 move to an unpinned bucket is a
// change to R2_ENDPOINT and R2_BUCKET_NAME rather than a code deploy landing
// in the middle of a data migration.
const R2_ENDPOINT =
  env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`;

export const r2 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export const ALLOWED_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export function isVideoMime(mimeType: string) {
  return baseMimeType(mimeType).startsWith("video/");
}

export function isAllowedMime(mimeType: string): boolean {
  return (ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(baseMimeType(mimeType));
}

export function extensionForMime(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return extensions[baseMimeType(mimeType)] ?? "bin";
}

export function maxBytesForMime(
  mimeType: string,
  limits: { maxPhotoBytes?: number; maxVideoBytes?: number } = {},
) {
  return isVideoMime(mimeType)
    ? (limits.maxVideoBytes ?? MAX_VIDEO_BYTES)
    : (limits.maxPhotoBytes ?? MAX_PHOTO_BYTES);
}

/** Random, unguessable, and groupable-by-event for cron purge. */
export function blobPathnameFor(eventId: string, mediaId: string, extension: string) {
  return `events/${eventId}/${mediaId}.${extension}`;
}

export async function deleteBlobs(pathnames: string[]) {
  if (pathnames.length === 0) return;
  for (let index = 0; index < pathnames.length; index += 1000) {
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Delete: { Objects: pathnames.slice(index, index + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}
