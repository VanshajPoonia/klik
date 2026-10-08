import { THUMB_QUALITY, thumbnailSize } from "./thumbnail-size";

/**
 * Makes the grid rendition on the uploader's own device, from the already
 * compressed photo or a video's poster still. Same reasoning as
 * lib/image-compress.ts: the work is spread across every guest's phone instead
 * of queuing on the server.
 *
 * Returns null whenever the browser cannot do it. The upload never waits on
 * this and never fails because of it; the server's thumbnail job covers any
 * photo that arrives without one.
 */
export async function makeThumbnail(source: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    const { width, height } = thumbnailSize(bitmap.width, bitmap.height);
    if (!width || !height) {
      bitmap.close();
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // JPEG rather than WebP: Safari's canvas cannot encode WebP and silently
    // hands back a PNG, which for a photo is several times larger.
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", THUMB_QUALITY / 100),
    );
  } catch {
    return null;
  }
}
