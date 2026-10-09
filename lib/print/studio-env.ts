import type { PrintDoc } from "./doc";
import { MM_PER_POINT, findFont, nearestWeight } from "./fonts";

/**
 * QR-4c, in the browser: the studio's fonts and images, ready to draw. A
 * canvas draws with whatever face the browser has at that moment, so fonts
 * are asked for explicitly and waited on before anything is drawn for export.
 */

/** The family `next/font` gave this font on this page, with its fallback. */
export function resolveFamily(key: string): string {
  const font = findFont(key);
  if (typeof document === "undefined") return font.fallback;
  const holder = document.querySelector<HTMLElement>("[data-print-fonts]") ?? document.documentElement;
  const value = getComputedStyle(holder).getPropertyValue(font.cssVar).trim();
  return value ? `${value}, ${font.fallback}` : font.fallback;
}

/** Waits for every face a design uses. Never throws: a missing face falls back. */
export async function loadDocFonts(doc: PrintDoc): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const wanted = new Set<string>();
  for (const element of doc.elements) {
    if (element.type !== "text") continue;
    const font = findFont(element.font);
    const weight = nearestWeight(font, element.weight);
    wanted.add(`${element.italic && font.italic ? "italic " : ""}${weight} ${Math.max(12, element.size * MM_PER_POINT * 4)}px ${resolveFamily(font.key)}`);
  }
  await Promise.all([...wanted].map((face) => document.fonts.load(face).catch(() => [])));
}

/** Every face the font picker shows, so its previews draw in their own type. */
export async function loadAllFonts(keys: string[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(keys.map((key) => document.fonts.load(`400 16px ${resolveFamily(key)}`).catch(() => [])));
}

export type DecodedImage = ImageBitmap | HTMLImageElement;

/**
 * An uploaded image, fetched as bytes and decoded here. Fetching rather than
 * pointing an `img` at the URL keeps the canvas untainted, which an export
 * needs, and needs nothing from the bucket's CORS beyond a plain GET.
 */
export async function loadImage(url: string): Promise<DecodedImage> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The image could not be loaded (${response.status})`);
  const blob = await response.blob();
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * An image chosen for upload, re-drawn on a canvas before it leaves the
 * device: that drops whatever the camera wrote into it (location included),
 * applies its rotation, and gives its true pixel size for the print checks.
 * PNGs stay PNG so a logo keeps its transparency.
 */
export async function prepareUpload(file: File): Promise<{ blob: Blob; width: number; height: number; mimeType: "image/png" | "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const longest = 8000;
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("The image could not be read"))), mimeType, 0.92),
  );
  return { blob, width, height, mimeType };
}
