/**
 * Client-side poster frames and duration probing for uploaded video.
 *
 * Why this exists: the gallery grid used to render `<video preload="metadata">`
 * for every clip just to show a first frame. "Metadata" sounds cheap, but
 * iPhone `.mov` files routinely store the `moov` atom at the *end* of the file,
 * so the browser has to reach a long way into a 200 MB recording to find it,
 * once per video tile on screen. On venue wifi that is the difference between a
 * gallery that loads and one that does not.
 *
 * Extracting a small still at upload time, on the uploader's own device, means
 * the grid can use `preload="none"` and a plain image. It costs the uploader
 * one seek they never notice and it removes the per-viewer cost entirely.
 *
 * This is not transcoding. The original is still what plays back and what
 * downloads. Proper HLS renditions are OPS-1 and need a server-side job.
 */

export interface VideoProbe {
  /** JPEG still from near the start of the clip, or null if extraction failed. */
  poster: Blob | null;
  width: number;
  height: number;
  /** Seconds, or null when the browser cannot determine it. */
  duration: number | null;
}

const POSTER_MAX_EDGE = 1280;
const POSTER_QUALITY = 0.72;

/** Seeks a hair past the start: frame zero is often black on phone recordings. */
const POSTER_SEEK_SECONDS = 0.15;

function drawToCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Reads dimensions and duration from a video file and grabs a poster still.
 *
 * Every failure path returns a usable object rather than throwing. A missing
 * poster degrades the grid to the old behaviour; a failed upload because the
 * browser would not decode someone's codec is a guest who walks away, so this
 * never blocks the upload it is attached to.
 */
export function probeVideo(file: Blob): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const fallback: VideoProbe = { poster: null, width: 0, height: 0, duration: null };

    if (typeof document === "undefined") {
      resolve(fallback);
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (probe: VideoProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(probe);
    };

    // A codec the browser half-supports can leave both `seeked` and `error`
    // unfired forever, which would hang the upload queue behind it.
    const timer = setTimeout(() => finish(fallback), 10_000);

    video.preload = "metadata";
    video.muted = true;
    // Required on iOS or the element refuses to decode without a user gesture.
    video.playsInline = true;

    video.onerror = () => finish(fallback);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      const dimensions = { width: video.videoWidth, height: video.videoHeight };

      video.onseeked = () => {
        const canvas = drawToCanvas(video);
        if (!canvas) {
          finish({ poster: null, ...dimensions, duration });
          return;
        }
        canvas.toBlob(
          (blob) => finish({ poster: blob, ...dimensions, duration }),
          "image/jpeg",
          POSTER_QUALITY,
        );
      };

      // Clamp the seek inside the clip so very short videos still yield a frame.
      video.currentTime = duration ? Math.min(POSTER_SEEK_SECONDS, duration / 2) : 0;
    };

    video.src = url;
  });
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
