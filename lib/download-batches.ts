const MAX_ZIP_BYTES = Math.floor(1.8 * 1024 * 1024 * 1024);
const MAX_ZIP_ITEMS = 200;

export function buildDownloadBatches<T extends { sizeBytes: number }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const wouldExceedSize = current.length > 0 && currentBytes + item.sizeBytes > MAX_ZIP_BYTES;
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
