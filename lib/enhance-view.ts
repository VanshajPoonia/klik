/**
 * Viewer-side enhancement: photos get auto-levelled on the device of whoever
 * is looking at them, never on the server and never in storage.
 *
 * **The stored file is never modified.** Enhancement happens after the bytes
 * arrive, is a per-viewer preference, and can be turned off to see exactly what
 * was uploaded. That matters for a product where an organizer may be a
 * professional whose own grade is the deliverable, and it is why this is a view
 * concern rather than an upload one.
 *
 * ## Why no library
 *
 * The obvious move is a WASM image library (photon, wasm-vips, OpenCV.js) and
 * it is the wrong one here. The operation we want is histogram auto-levels,
 * which `autoEnhance` in `lib/image-enhance.ts` already implements and already
 * ships, because the in-app camera bakes it into captures. Pulling in a second
 * implementation would add somewhere between 500 KB and several MB to the
 * bundle to compute the same thing, and it would land on a phone on venue wifi,
 * which is the exact condition this product is built around. The existing pass
 * is two linear scans over the pixel buffer with no allocation per pixel.
 *
 * ## Two tiers, matching what the camera already does
 *
 * The camera uses a CSS filter for the live preview and an exact pixel pass for
 * the saved file. This mirrors that split for the same reason:
 *
 * - **Grid thumbnails** get `VIEW_ENHANCE_FILTER`, a fixed CSS approximation.
 *   It is GPU-composited, costs no main-thread time, and applies to a hundred
 *   tiles at once. It cannot adapt per image, because CSS has no histogram.
 * - **The lightbox and downloads** get the real `autoEnhance` pass, which reads
 *   each image's own histogram and stretches that image's actual range. This is
 *   the accurate one, and it is affordable because it runs on one photo at a
 *   time.
 */

import { autoEnhance } from "./image-enhance";

/**
 * The cheap approximation used on grid tiles. Values are deliberately modest:
 * this is applied blind, with no knowledge of whether a given photo is already
 * well exposed, so it has to improve a flat photo without wrecking a good one.
 */
export const VIEW_ENHANCE_FILTER = "contrast(1.06) saturate(1.12) brightness(1.02)";

/**
 * Re-encode quality for the enhanced result. The stored file is already JPEG at
 * quality 80, so encoding the enhanced version higher keeps this pass from
 * being the visible generation loss.
 */
const ENHANCED_QUALITY = 0.92;

const PREFERENCE_KEY = "klik_enhance_view";

/**
 * Enhancement is on unless the viewer turned it off. Reading can throw in a
 * private window or with site data blocked, and the gallery has to render
 * either way, so every access is guarded.
 */
export function readEnhancePreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnhancePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // A viewer who cannot persist the choice still gets it for this session.
  }
}

/**
 * The preference is browser state that React does not own, which is exactly
 * what `useSyncExternalStore` exists for. Reading it in an effect and calling
 * setState would work, but it renders once with the wrong value first and then
 * corrects itself, which is a visible flash of unenhanced photos on every load.
 *
 * The server snapshot is `true` so the markup React renders on the server
 * matches the default, and only a viewer who actively turned enhancement off
 * sees it change after hydration.
 */
const listeners = new Set<() => void>();

export function subscribeEnhancePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the setting should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export const getEnhancePreference = readEnhancePreference;
export const getEnhancePreferenceOnServer = () => true;

export function setEnhancePreference(enabled: boolean): void {
  writeEnhancePreference(enabled);
  for (const listener of listeners) listener();
}

/**
 * Fetches a photo, applies histogram auto-levels, and returns the result.
 *
 * Returns null on any failure, and callers show the original instead. The
 * failure modes are real rather than theoretical: the media URL redirects to a
 * signed R2 URL, so this is a cross-origin read that depends on the bucket
 * returning `Access-Control-Allow-Origin`. It does in production, verified
 * against the live bucket, but a local dev origin is not in that policy, so
 * enhancement quietly does nothing against `localhost` and the gallery still
 * works. Never let this throw into a render path.
 */
export async function enhancePhoto(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const response = await fetch(url, { signal, mode: "cors", credentials: "include" });
    if (!response.ok) return null;

    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(bitmap, 0, 0);
      // Bails out internally on a tainted canvas, so a CORS failure that got
      // this far still degrades to "no enhancement" rather than an exception.
      autoEnhance(ctx, canvas.width, canvas.height);

      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", ENHANCED_QUALITY),
      );
    } finally {
      // Decoded bitmaps hold real memory. A guest swiping through two hundred
      // photos will leak a gallery's worth of them without this.
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Saves a blob under a given filename, for the enhanced-download path. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers, so this
  // waits a beat rather than racing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Mirrors `downloadFilename` in the download route so both paths agree. */
export function downloadFilename(slug: string, mediaId: string, extension = "jpg"): string {
  return `${slug}-${mediaId.slice(0, 8)}.${extension}`;
}
