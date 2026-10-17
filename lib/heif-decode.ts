import { detectMediaSignature } from "./file-signature";

/**
 * HEIC and HEIF photos decoded on the uploader's device, where the browser
 * cannot do it itself.
 *
 * Safari reads HEIC natively, and an iPhone hands Safari a JPEG anyway, so
 * this is for everyone else: a Samsung set to save "high efficiency" photos,
 * or iPhone pictures copied to a PC or Mac and uploaded from Chrome, Edge or
 * Firefox. Those used to go up as they were and be converted by the server,
 * which is slow and holds a function for seconds per photo. Now the device
 * does it, with libheif compiled to WebAssembly (`libheif-js`, LGPL-3.0, the
 * same library the server's `heic-convert` uses), fetched as its own chunk of
 * about 1.5 MB the first time it is needed and never otherwise.
 *
 * libheif applies the file's rotation and mirroring as it decodes, so the
 * pixels come out upright. Anything it cannot read returns null, and the
 * server's conversion stays as the fallback.
 */

/** Past this, the decoded pixels alone would take a phone's tab down (4 bytes each). */
const MAX_PIXELS = 50_000_000;

export async function isHeif(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const match = detectMediaSignature(head);
  return match?.family === "image" && match.format.startsWith("heif:") && match.format !== "heif:avif" && match.format !== "heif:avis";
}

/** The photo as an upright bitmap, or null when it is not HEIF or cannot be decoded here. */
export async function decodeHeif(file: Blob): Promise<ImageBitmap | null> {
  if (typeof window === "undefined" || !(await isHeif(file))) return null;
  const { default: load } = await import("libheif-js/libheif-wasm/libheif-bundle.mjs");
  const libheif = load();
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  try {
    // The primary image comes first: a burst or a Live Photo's extra frames follow it.
    const image = images[0];
    if (!image) return null;
    const width = image.get_width();
    const height = image.get_height();
    if (!width || !height || width * height > MAX_PIXELS) return null;
    const pixels = await new Promise<Uint8ClampedArray<ArrayBuffer> | null>((resolve) =>
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (shown) => resolve(shown?.data ?? null)),
    );
    if (!pixels) return null;
    return await createImageBitmap(new ImageData(pixels, width, height));
  } finally {
    for (const image of images) image.free();
    decoder.decoder.delete();
  }
}
