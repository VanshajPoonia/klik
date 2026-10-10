import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { deleteBlobs, proofPathnameFor, r2, thumbPathnameFor } from "./storage";
import { watermarkPhoto } from "./watermark";
import { renderThumbnail } from "./thumbnail";
import type { Watermark } from "./proofs";

/**
 * MED-10: stamping a proof. Loads sharp, so a route importing this needs the
 * libvips tracing include in next.config.ts (lib/native-deps.test.ts checks).
 */

// Stamp keys are never overwritten (a new stamp gets a new key), so a stamp
// read once in a warm function can be kept for the next proof in the batch.
const stampCache = new Map<string, Buffer>();

async function readObject(key: string): Promise<Buffer> {
  const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  if (!object.Body) throw new Error(`No body for ${key}`);
  return Buffer.from(await object.Body.transformToByteArray());
}

async function stampBytes(key: string): Promise<Buffer> {
  const cached = stampCache.get(key);
  if (cached) return cached;
  const bytes = await readObject(key);
  if (stampCache.size >= 16) stampCache.delete(stampCache.keys().next().value!);
  stampCache.set(key, bytes);
  return bytes;
}

export { readObject as readStoredObject };

/**
 * Stamps one photo and stores the watermarked copy and its grid tile. The
 * tile goes to the photo's usual thumbnail key, replacing any clean one the
 * uploader's browser sent, so no clean pixels are left under a name the
 * gallery serves. Throws if anything fails, so the upload is retried.
 */
export async function makeProof({
  eventId,
  mediaId,
  photo,
  watermark,
}: {
  eventId: string;
  mediaId: string;
  photo: Buffer;
  watermark: Watermark;
}): Promise<{ blobPathname: string; thumbPathname: string | null; width: number; height: number }> {
  const stamp = await stampBytes(watermark.stampKey);
  const stamped = await watermarkPhoto(
    photo,
    { data: stamp, width: watermark.stampWidth, height: watermark.stampHeight },
    { position: watermark.position, opacity: watermark.opacity, scale: watermark.scale },
  );
  const blobPathname = proofPathnameFor(eventId, mediaId);
  await r2.send(
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: blobPathname, Body: stamped.data, ContentType: "image/jpeg" }),
  );

  const thumbKey = thumbPathnameFor(eventId, mediaId);
  const thumb = await renderThumbnail(stamped.data);
  if (thumb) {
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: thumbKey, Body: thumb, ContentType: "image/jpeg" }));
  } else {
    // No tile could be made: make sure a clean one from the browser is not
    // left behind. The grid shows the watermarked photo instead.
    await deleteBlobs([thumbKey]);
  }
  return { blobPathname, thumbPathname: thumb ? thumbKey : null, width: stamped.width, height: stamped.height };
}
