import { PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isVideoMime, posterPathnameFor, r2, thumbPathnameFor } from "@/lib/storage";

/**
 * Presigned slots for an upload's pieces, shared by `/api/upload`, which
 * starts an upload, and `/api/upload/parts`, which resumes one (OPS-3).
 *
 * Every slot binds its exact length (ContentLength lands in the signed
 * headers), so no slot can carry more bytes than the plan check allowed.
 */

/** Part URLs live an hour: a slow venue connection can take most of that to
 *  reach the last part, and R2 checks the signature when a part starts. */
export const PART_URL_SECONDS = 60 * 60;
const STILL_URL_SECONDS = 5 * 60;

export interface StillSlots {
  posterUploadUrl: string | null;
  posterPathname: string | null;
  thumbUploadUrl: string | null;
  thumbPathname: string | null;
}

function signedPut(key: string, contentType: string, length: number, seconds: number) {
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: length }),
    { expiresIn: seconds },
  );
}

/**
 * The poster still (videos only) and the grid thumbnail the client made, each
 * at the key this media id would be given, so a still slot cannot be used to
 * smuggle a large upload past the plan cap.
 */
export async function signStillSlots(
  eventId: string,
  mediaId: string,
  mimeType: string,
  sizes: { posterBytes?: number; thumbBytes?: number },
): Promise<StillSlots> {
  const slots: StillSlots = { posterUploadUrl: null, posterPathname: null, thumbUploadUrl: null, thumbPathname: null };
  if (isVideoMime(mimeType) && sizes.posterBytes) {
    slots.posterPathname = posterPathnameFor(eventId, mediaId);
    slots.posterUploadUrl = await signedPut(slots.posterPathname, "image/jpeg", sizes.posterBytes, STILL_URL_SECONDS);
  }
  if (sizes.thumbBytes) {
    slots.thumbPathname = thumbPathnameFor(eventId, mediaId);
    slots.thumbUploadUrl = await signedPut(slots.thumbPathname, "image/jpeg", sizes.thumbBytes, STILL_URL_SECONDS);
  }
  return slots;
}

/** One URL per part asked for, each bound to that part's exact length. */
export function signPartUrls(
  key: string,
  uploadId: string,
  parts: Array<{ number: number; length: number }>,
): Promise<string[]> {
  return Promise.all(
    parts.map(({ number, length }) =>
      getSignedUrl(
        r2,
        new UploadPartCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          PartNumber: number,
          ContentLength: length,
        }),
        { expiresIn: PART_URL_SECONDS },
      ),
    ),
  );
}
