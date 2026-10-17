import { readCaptureTimeFromFile } from "../exif";
import { compressImageForUpload } from "../image-compress";
import { makeThumbnail } from "../image-thumbnail";
import { compressVideoForUpload } from "../video-compress";
import { formatDuration, probeVideo } from "../video-poster";
import type { QueuedUpload } from "./record";

/**
 * The page half of an upload: everything that needs pixels, done on the
 * uploader's own device before a byte is sent, so the cost is spread across
 * every guest's phone instead of the server. None of it needs a connection,
 * so a guest with no signal still gets their photos ready to go.
 *
 * Page-only: canvases and video elements. The service worker sends only items
 * a page has already prepared.
 */
export async function prepareUpload(
  item: Pick<QueuedUpload, "file" | "kind" | "mimeType" | "preparedSize" | "capturedAt" | "maxVideoSeconds" | "keepOriginal">,
  /** How far a video's conversion has got, 0 to 1. Photos are quick enough not to report. */
  onProgress?: (fraction: number) => void,
): Promise<Partial<QueuedUpload>> {
  const { file, preparedSize } = item;
  const isPhoto = item.kind === "photo";

  // A file the phone will not hand over (a cloud photo never downloaded, one
  // deleted since it was picked) would otherwise fail every send as if the
  // wifi were down, and wait for ever. Asked once, here, and said plainly.
  try {
    await file.slice(0, 16).arrayBuffer();
  } catch {
    return {
      ready: true,
      refused: { message: "This file could not be read from the device. Pick it again.", status: 0, code: "unreadable" },
    };
  }

  // Read when the photo was taken BEFORE compressing it. The compression pass
  // draws to a canvas, and a canvas cannot carry metadata across, so this is
  // the last moment the camera's timestamp exists. Camera captures arrive
  // already prepared and never had EXIF to begin with.
  const capturedAt = item.capturedAt ?? (isPhoto && !preparedSize ? await readCaptureTimeFromFile(file) : null);

  // Falls back to the original file (and the server's own compression) if the
  // browser cannot decode it, e.g. HEIC outside Safari.
  // MED-8: kept as shot when the host keeps camera details; the server removes
  // the location and nothing else, and makes the sizes itself.
  const compressed = isPhoto && !preparedSize && !item.keepOriginal ? await compressImageForUpload(file) : null;

  // A still and the duration, pulled out here. The still lets every viewer's
  // grid load an image instead of reaching into a 200 MB file for its moov
  // atom, and the duration lets a clip nobody wants to stream stop here,
  // before a minute is spent converting it.
  const original = isPhoto ? null : await probeVideo(file);
  if (original?.duration && original.duration > item.maxVideoSeconds) {
    return {
      ready: true,
      refused: {
        message: `Videos are limited to ${formatDuration(item.maxVideoSeconds)}. This one is ${formatDuration(original.duration)}.`,
        status: 413,
        code: "video_too_long",
        values: { seconds: item.maxVideoSeconds, actual: Math.round(original.duration) },
      },
    };
  }

  // Made smaller here, and H.264 so every browser plays it, the way photos are
  // compressed above (lib/video-compress.ts). Null sends the clip as picked;
  // a conversion the phone interrupted throws, and the queue tries it again.
  // The still and the size then come from the copy that is actually sent,
  // which also gives a still to a clip this browser could not draw as filmed.
  const shrunk = isPhoto ? null : await compressVideoForUpload(file, { onProgress });
  const shrunkProbe = shrunk ? await probeVideo(shrunk.file) : null;
  // A copy this browser cannot draw back is not trusted; the clip goes as picked.
  const sent = shrunk && shrunkProbe?.width ? shrunk.file : null;
  const probe = sent ? shrunkProbe : original;

  // The grid tile, made from pixels this device has already decoded. A photo
  // the browser could not decode has no source, and the server makes its
  // thumbnail instead.
  const thumbSource = isPhoto ? (compressed?.blob ?? (preparedSize || item.keepOriginal ? file : null)) : (probe?.poster ?? null);
  const thumb = thumbSource ? await makeThumbnail(thumbSource) : null;

  return {
    ready: true,
    ...(compressed ? { file: compressed.blob, mimeType: "image/jpeg" } : sent ? { file: sent, mimeType: "video/mp4" } : {}),
    thumb,
    poster: probe?.poster ?? null,
    width: compressed?.width ?? (sent ? probe?.width : preparedSize?.width) ?? (probe?.width || null),
    height: compressed?.height ?? (sent ? probe?.height : preparedSize?.height) ?? (probe?.height || null),
    durationS: probe?.duration ?? null,
    // A converted clip carries no metadata, so its capture time comes from the device.
    capturedAt: capturedAt ?? (sent ? (shrunk?.capturedAt ?? null) : null),
    clientCompressed: Boolean(compressed) || Boolean(preparedSize) || Boolean(sent),
  };
}
