import { compressImageForUpload } from "./image-compress";
import { makeThumbnail } from "./image-thumbnail";
import { uploadInParts } from "./multipart-client";
import { formatDuration, probeVideo } from "./video-poster";
import { readCaptureTimeFromFile } from "./exif";

/**
 * The browser half of the upload path (ARCHITECTURE.md section 6), shared by
 * the gallery and the kiosk (VEN-2) so there is one of it: prepare on this
 * device, sign, send the bytes straight to R2, then register.
 */

const RETRY_DELAYS = [600, 1800];

export function putObject(
  url: string,
  body: Blob,
  mimeType: string,
  onProgress: (percentage: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () =>
      xhr.status < 300
        ? resolve()
        : reject(Object.assign(new Error(`Upload failed: ${xhr.status}`), { status: xhr.status }));
    xhr.onerror = () => reject(Object.assign(new Error("Network error"), { status: 0 }));
    xhr.send(body);
  });
}

/** Venue wifi drops constantly, so a transient failure retries with backoff
 * before it counts as lost. PUT to a fixed key is idempotent, so replaying it
 * is safe. Client errors (too large, rejected) fail immediately. */
export async function putWithRetry(
  url: string,
  body: Blob,
  mimeType: string,
  onProgress: (percentage: number) => void,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await putObject(url, body, mimeType, onProgress);
      return;
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

export interface GalleryUpload {
  eventId: string;
  slug: string;
  mediaId: string;
  file: File;
  /** Set when the file is already at final size and quality (camera captures),
   * letting the uploader skip a redundant decode/re-encode. */
  prepared?: { width: number; height: number };
  albumId?: string | null;
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
  maxVideoSeconds,
  onProgress = () => {},
}: GalleryUpload): Promise<{ media?: unknown }> {
  // Compress+sharpen on the uploader's own device so this cost is spread
  // across every guest's hardware instead of running once per upload on the
  // server. Falls back to the original file (and the server's own
  // compression) if the browser can't decode it, e.g. HEIC outside Safari.
  // Camera captures arrive already prepared.
  const isPhoto = !file.type.startsWith("video/");

  // Read when the photo was taken BEFORE compressing it. The compression pass
  // draws to a canvas, and a canvas cannot carry metadata across, so this is
  // the last moment the camera's timestamp exists. Camera captures arrive
  // already prepared and never had EXIF to begin with.
  const capturedAt = isPhoto && !prepared ? await readCaptureTimeFromFile(file) : null;

  const compressed = isPhoto && !prepared ? await compressImageForUpload(file) : null;

  // Pull a still and the duration out of the video here, on the uploader's
  // device. The still lets every viewer's grid load an image instead of
  // reaching into a 200 MB file for its moov atom, and the duration lets the
  // server reject a clip nobody wants to stream.
  const probe = isPhoto ? null : await probeVideo(file);
  if (probe?.duration && probe.duration > maxVideoSeconds) {
    throw new Error(
      `Videos are limited to ${formatDuration(maxVideoSeconds)}. This one is ${formatDuration(probe.duration)}.`,
    );
  }

  const uploadBody = compressed?.blob ?? file;
  const mimeType = compressed ? "image/jpeg" : file.type;

  // The grid tile, made here from pixels this device has already decoded. A
  // photo the browser could not decode (HEIC outside Safari) has no source,
  // and the server makes its thumbnail instead.
  const thumbSource = isPhoto ? (compressed?.blob ?? (prepared ? file : null)) : (probe?.poster ?? null);
  const thumbnail = thumbSource ? await makeThumbnail(thumbSource) : null;

  const signRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId,
      mediaId,
      mimeType,
      sizeBytes: uploadBody.size,
      posterBytes: probe?.poster?.size,
      thumbBytes: thumbnail?.size,
    }),
  });
  const signed = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new UploadRefused(signed.error ?? "Failed to get upload URL", { ...signed, status: signRes.status });
  const { uploadUrl, multipart, pathname, posterUploadUrl, posterPathname, thumbUploadUrl, thumbPathname } = signed;

  if (multipart) {
    // OPS-2: large files go up in parts, each retried on its own, so a wifi
    // drop costs a part rather than the whole video.
    await uploadInParts(uploadBody, { urls: multipart.urls, partSize: multipart.partSize, onProgress });
    const completeRes = await fetch("/api/upload/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        mediaId,
        mimeType,
        sizeBytes: uploadBody.size,
        uploadId: multipart.uploadId,
      }),
    });
    if (!completeRes.ok) {
      const completed = await completeRes.json().catch(() => ({}));
      throw new UploadRefused(completed.error ?? "Upload could not be finished", { ...completed, status: completeRes.status });
    }
  } else {
    await putWithRetry(uploadUrl, uploadBody, mimeType, onProgress);
  }

  // Best effort: a gallery with a missing poster falls back to the old
  // behaviour, which is far better than failing a guest's upload because a
  // thumbnail would not send.
  let uploadedPoster: string | null = null;
  if (posterUploadUrl && posterPathname && probe?.poster) {
    try {
      await putObject(posterUploadUrl, probe.poster, "image/jpeg", () => {});
      uploadedPoster = posterPathname;
    } catch {
      uploadedPoster = null;
    }
  }

  let uploadedThumb: string | null = null;
  if (thumbUploadUrl && thumbPathname && thumbnail) {
    try {
      await putObject(thumbUploadUrl, thumbnail, "image/jpeg", () => {});
      uploadedThumb = thumbPathname;
    } catch {
      uploadedThumb = null;
    }
  }

  const registerRes = await fetch(`/api/e/${slug}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaId,
      pathname,
      mimeType,
      sizeBytes: uploadBody.size,
      width: compressed?.width ?? prepared?.width ?? (probe?.width || undefined),
      height: compressed?.height ?? prepared?.height ?? (probe?.height || undefined),
      durationS: probe?.duration ?? undefined,
      posterPathname: uploadedPoster ?? undefined,
      thumbPathname: uploadedThumb ?? undefined,
      clientCompressed: Boolean(compressed) || Boolean(prepared),
      capturedAt: capturedAt ?? undefined,
      albumId: albumId || null,
    }),
  });
  const registered = await registerRes.json().catch(() => ({}));
  if (!registerRes.ok) {
    throw new UploadRefused(registered.error ?? "Could not add media to the gallery", { ...registered, status: registerRes.status });
  }
  return registered;
}
