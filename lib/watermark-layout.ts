import type { WatermarkPosition } from "./schema";

/**
 * MED-10: where a watermark goes on a photo, and how big. Pure, and shared by
 * the account page's preview and the server that stamps proofs, so what the
 * photographer sees while choosing is what lands on their photos.
 *
 * `scale` is the stamp's width as a share of the photo's width in a corner.
 * The middle uses more of it and a tiled stamp less, so one slider means
 * roughly "how much of the photo the mark covers" in every position.
 */

export type StampPlacement =
  | { tile: false; width: number; height: number; left: number; top: number }
  | { tile: true; width: number; height: number; gapX: number; gapY: number };

export const WATERMARK_DEFAULTS = { position: "bottom-right" as WatermarkPosition, opacity: 0.5, scale: 0.3 };

export function stampPlacement(
  image: { width: number; height: number },
  stamp: { width: number; height: number },
  position: WatermarkPosition,
  scale: number,
): StampPlacement {
  const aspect = stamp.height / Math.max(1, stamp.width);
  const factor = position === "center" ? 1.6 : position === "tiled" ? 0.7 : 1;
  let width = image.width * clamp(scale, 0.1, 0.6) * factor;
  // A tall stamp (a logo over two lines) is held to part of the photo's height.
  const maxHeight = image.height * (position === "center" ? 0.6 : 0.35);
  if (width * aspect > maxHeight) width = maxHeight / aspect;
  width = Math.max(1, Math.min(Math.round(width), Math.round(image.width * 0.9)));
  const height = Math.max(1, Math.round(width * aspect));

  if (position === "tiled") {
    return { tile: true, width, height, gapX: Math.round(width * 0.6), gapY: Math.round(height * 1.6) };
  }
  const margin = Math.round(Math.min(image.width, image.height) * 0.03);
  const top = position === "center" ? Math.round((image.height - height) / 2) : image.height - height - margin;
  const left =
    position === "center"
      ? Math.round((image.width - width) / 2)
      : position === "bottom-left"
        ? margin
        : image.width - width - margin;
  return { tile: false, width, height, left: Math.max(0, left), top: Math.max(0, top) };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
