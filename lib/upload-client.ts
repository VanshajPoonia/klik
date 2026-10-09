import { prepareUpload } from "./upload-queue/prepare";
import { newQueuedUpload, type QueuedUpload } from "./upload-queue/record";
import { SendFailure, sendUpload } from "./upload-queue/send";
import { xhrPut } from "./upload-queue/transport";

/**
 * The browser half of the upload path (ARCHITECTURE.md section 6), sent
 * straight through rather than queued: prepare on this device, sign, send the
 * bytes to R2, register.
 *
 * Almost every upload goes through the queue instead (OPS-3,
 * `lib/upload-queue`), which keeps the file on the device until it lands.
 * This is for the one that is waited on: an edited copy (CAM-2), which the
 * editor opens the moment it is in and reports a failure of on the spot. Both
 * run the same preparation and the same send, so there is one protocol.
 */

export interface GalleryUpload {
  eventId: string;
  slug: string;
  mediaId: string;
  file: File;
  /** Set when the file is already at final size and quality (camera captures),
   * letting the uploader skip a redundant decode/re-encode. */
  prepared?: { width: number; height: number };
  albumId?: string | null;
  /** GRW-3: the challenge card it was taken from. */
  challengeId?: string | null;
  /** CAM-1: when a camera capture was taken. A capture has no EXIF to read. */
  capturedAt?: string | null;
  /** CAM-2: the photo this is an edited copy of. */
  derivedFromId?: string | null;
  maxVideoSeconds: number;
  onProgress?: (percentage: number) => void;
}

/** An upload the server refused, with whatever it said about why. */
export class UploadRefused extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Uploads one file and registers it. Resolves to the registration response. */
export async function uploadToGallery({
  eventId,
  slug,
  mediaId,
  file,
  prepared,
  albumId = null,
  challengeId = null,
  capturedAt = null,
  derivedFromId = null,
  maxVideoSeconds,
  onProgress = () => {},
}: GalleryUpload): Promise<{ media?: unknown }> {
  let item: QueuedUpload = newQueuedUpload(
    mediaId,
    { file, prepared, challengeId, capturedAt },
    { eventId, slug, albumId, maxVideoSeconds },
  );
  item = { ...item, ...(await prepareUpload(item)) };
  if (item.refused) throw new UploadRefused(item.refused.message, { status: item.refused.status });

  try {
    const result = await sendUpload(item, {
      fetch: (input, init) => fetch(input, init),
      put: xhrPut,
      patienceMs: 5 * 60 * 1000,
      save: async (patch) => {
        item = { ...item, sent: { ...item.sent, ...patch } };
      },
      onProgress: (fraction) => onProgress(fraction * 100),
      extra: derivedFromId ? { derivedFromId } : undefined,
    });
    return { media: result.media ?? undefined };
  } catch (error) {
    if (error instanceof SendFailure) throw new UploadRefused(error.message, { ...error.detail, status: error.status });
    throw error;
  }
}
