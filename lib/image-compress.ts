import { COMPRESS_MAX_DIMENSION, COMPRESS_QUALITY } from "./media-constants";

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Mild unsharp-style kernel to counter the softening resize introduces.
 * Kept low so the added high-frequency detail doesn't meaningfully inflate
 * the JPEG's size. */
const SHARPEN_AMOUNT = 0.15;

function sharpen(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const src = ctx.getImageData(0, 0, width, height);
  const srcData = src.data;
  const out = ctx.createImageData(width, height);
  const outData = out.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = srcData[i + c];
        const up = y > 0 ? srcData[i - width * 4 + c] : center;
        const down = y < height - 1 ? srcData[i + width * 4 + c] : center;
        const left = x > 0 ? srcData[i - 4 + c] : center;
        const right = x < width - 1 ? srcData[i + 4 + c] : center;
        const value = center + SHARPEN_AMOUNT * (4 * center - up - down - left - right);
        outData[i + c] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
      outData[i + 3] = srcData[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

/**
 * Resizes and re-encodes an image entirely on the user's device, so the
 * compression work is spread across every uploader's own hardware instead of
 * running once per upload on the server. Returns null if the browser can't
 * decode the file (e.g. HEIC on a non-Safari browser) - callers should fall
 * back to uploading the original and letting the server compress it instead.
 */
export async function compressImageForUpload(file: File): Promise<CompressedImage | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // Only sharpen if we actually downscaled - an already native-resolution
    // image doesn't need it and sharpening it only adds size for no benefit.
    if (scale < 1) sharpen(ctx, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY / 100),
    );
    if (!blob) return null;

    return { blob, width, height };
  } catch {
    return null;
  }
}
