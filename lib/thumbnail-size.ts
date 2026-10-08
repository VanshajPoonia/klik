/**
 * The grid rendition, sized once for every place that makes one: the
 * uploader's browser, the registration route and the thumbnail job.
 *
 * Tiles are square and cropped by CSS, so what matters is the **short** side.
 * The widest tile is about 250 CSS pixels on a desktop grid and about 165 on a
 * phone, and both reach roughly 500 device pixels at the screens people use.
 * 480 on the short side covers that; the long side is capped so a panorama
 * does not turn into a full-size image under another name.
 */
export const THUMB_SHORT_EDGE = 480;
export const THUMB_MAX_LONG_EDGE = 960;
export const THUMB_QUALITY = 72;

/** Ceiling the server accepts for an uploaded thumbnail. A 960x480 JPEG at
 *  quality 72 is around 60 KB, so this is generous, and still small enough that
 *  the slot cannot be used to smuggle a real file past the plan cap. */
export const MAX_THUMB_BYTES = 400 * 1024;

/** Ceiling for a video's poster still, which is a full frame up to 1280px. */
export const MAX_POSTER_BYTES = 2 * 1024 * 1024;

export function thumbnailSize(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const scale = Math.min(1, THUMB_SHORT_EDGE / short, THUMB_MAX_LONG_EDGE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
