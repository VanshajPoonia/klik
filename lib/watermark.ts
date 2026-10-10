import { stampPlacement } from "./watermark-layout";
import type { WatermarkPosition } from "./schema";

/**
 * MED-10: lays a photographer's stamp over a photo. The stamp is a transparent
 * PNG the browser drew, so this is image over image: no text, so no fonts,
 * which the server does not reliably have (see lib/qr-compose.ts).
 *
 * sharp is imported inside, as everywhere else, so a failed native load costs
 * this call and not every handler in the file that imports it.
 */
export async function watermarkPhoto(
  photo: Buffer,
  stamp: { data: Buffer; width: number; height: number },
  profile: { position: WatermarkPosition; opacity: number; scale: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = (await import("sharp")).default;

  // Orientation 5 to 8 means the stored pixels are on their side, so the
  // displayed width is the stored height, and that is the frame the stamp sits in.
  const meta = await sharp(photo, { failOn: "none" }).metadata();
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = (sideways ? meta.height : meta.width) ?? 0;
  const height = (sideways ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error("Photo has no dimensions");

  const placement = stampPlacement({ width, height }, stamp, profile.position, profile.scale);

  // Opacity is applied to the stamp's own alpha, so a soft logo edge stays soft.
  const { data, info } = await sharp(stamp.data)
    .resize(placement.width, placement.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const opacity = Math.min(0.9, Math.max(0.1, profile.opacity));
  for (let index = 3; index < data.length; index += 4) data[index] = Math.round(data[index] * opacity);
  const raw = { width: info.width, height: info.height, channels: 4 as const };

  let overlay: Buffer;
  let position: { left: number; top: number } | { tile: true; gravity: "northwest" };
  if (placement.tile) {
    // A tile with transparent space around it, repeated over the whole photo.
    overlay = await sharp(data, { raw })
      .extend({
        top: Math.round(placement.gapY / 2),
        bottom: Math.round(placement.gapY / 2),
        left: Math.round(placement.gapX / 2),
        right: Math.round(placement.gapX / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    position = { tile: true, gravity: "northwest" };
  } else {
    overlay = await sharp(data, { raw }).png().toBuffer();
    position = { left: placement.left, top: placement.top };
  }

  // Never `.withMetadata()`: what is stored carries no EXIF, as for every photo.
  const result = await sharp(photo, { failOn: "none" })
    .rotate()
    .composite([{ input: overlay, ...position }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data: result.data, width: result.info.width, height: result.info.height };
}
