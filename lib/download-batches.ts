const MAX_ZIP_BYTES = Math.floor(1.8 * 1024 * 1024 * 1024);
const MAX_ZIP_ITEMS = 200;

export function buildDownloadBatches<T extends { sizeBytes: number }>(items: T[], maxBytes = MAX_ZIP_BYTES): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const wouldExceedSize = current.length > 0 && currentBytes + item.sizeBytes > maxBytes;
    const wouldExceedCount = current.length >= MAX_ZIP_ITEMS;
    if (wouldExceedSize || wouldExceedCount) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.sizeBytes;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * At or below this, a ZIP streams straight to the browser as before. Above it,
 * the dashboard prepares an export in the background instead (MED-7): a
 * streamed ZIP has to finish inside one function's five minutes, and 400 MB is
 * about what a slow connection can take in that time with room to spare.
 */
export const INLINE_ZIP_LIMIT_BYTES = 400 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * The name a photo gets inside a ZIP, numbered in gallery order. One function
 * for the streamed ZIP and the background export, so the same gallery never
 * comes out named two different ways. `index` counts across every part.
 */
export function zipEntryName(
  index: number,
  item: { id: string; kind: "photo" | "video"; mimeType: string },
): string {
  const position = String(index + 1).padStart(3, "0");
  const extension = EXTENSIONS[item.mimeType.split(";")[0].trim().toLowerCase()] ?? "bin";
  return `${position}-${item.kind}-${item.id.slice(0, 8)}.${extension}`;
}
