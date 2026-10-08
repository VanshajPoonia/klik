import { THUMB_QUALITY, thumbnailSize } from "./thumbnail-size";
import { reportError } from "./observability";

/**
 * Server-side grid rendition, for photos that arrived without one: HEIC the
 * browser could not decode, uploads from older clients, and the backfill.
 *
 * sharp is imported inside, never at module scope, for the reason written in
 * the registration route: a failed native load must cost one thumbnail, not
 * every handler in the file. Returns null on any failure, because a missing
 * thumbnail degrades to the full image and is never worth failing over.
 */
export async function renderThumbnail(source: Buffer): Promise<Buffer | null> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    reportError("thumbnail.sharp_unavailable", error);
    return null;
  }

  try {
    // Orientation 5 to 8 means the stored pixels are on their side, so the
    // displayed width is the stored height.
    const meta = await sharp(source, { failOn: "none" }).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    if (!width || !height) return null;
    const target = thumbnailSize(width, height);

    return await sharp(source, { failOn: "none" })
      .rotate()
      .resize(target.width, target.height, { fit: "fill" })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    reportError("thumbnail.render_failed", error);
    return null;
  }
}
