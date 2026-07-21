import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

// klik-media is an EU-jurisdiction bucket, which requires the .eu. endpoint
// instead of R2's default global one, or every request 403s.
export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
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
  return mimeType.startsWith("video/");
}

export function isAllowedMime(mimeType: string): mimeType is (typeof ALLOWED_MEDIA_MIME_TYPES)[number] {
  return (ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function maxBytesForMime(mimeType: string) {
  return isVideoMime(mimeType) ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
}

/** Random, unguessable, and groupable-by-event for cron purge. */
export function blobPathnameFor(eventId: string, mediaId: string, extension: string) {
  return `events/${eventId}/${mediaId}.${extension}`;
}

export function publicUrlFor(pathname: string) {
  return `${process.env.R2_PUBLIC_URL}/${pathname}`;
}

export async function deleteBlobs(pathnames: string[]) {
  if (pathnames.length === 0) return;
  await r2.send(
    new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: { Objects: pathnames.map((Key) => ({ Key })) },
    }),
  );
}
