/**
 * AI-7 and AI-8 without a model: three numbers about a photo and what can be
 * done with them. Pure arithmetic over grey pixels, so it is tested without
 * images and runs the same in a job and in a test.
 *
 * - **Difference hash.** The photo shrunk to 9x8 grey; each bit says whether
 *   a pixel is brighter than its right-hand neighbour. Two shots of the same
 *   toast differ by a few bits, two different scenes by thirty.
 * - **Sharpness.** The variance of the Laplacian: how much the image changes
 *   from one pixel to the next. A blurred frame has little, a sharp one a lot.
 *   Only comparable between frames of one scene, which is how it is used.
 * - **Brightness.** Mean luminance, to keep a black frame out of a highlight.
 */

import type { Media } from "./schema";
import { momentTime, wallClockOffsetMinutes } from "./moments";

export function differenceHash(gray: Uint8Array): string {
  if (gray.length !== 72) throw new Error("A difference hash needs a 9x8 grey image");
  let hex = "";
  let nibble = 0;
  for (let bit = 0; bit < 64; bit += 1) {
    const row = Math.floor(bit / 8);
    const column = bit % 8;
    nibble = (nibble << 1) | (gray[row * 9 + column] > gray[row * 9 + column + 1] ? 1 : 0);
    if (bit % 4 === 3) {
      hex += nibble.toString(16);
      nibble = 0;
    }
  }
  return hex;
}

const BITS_IN_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function hammingDistance(a: string, b: string): number {
  let count = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    count += BITS_IN_NIBBLE[parseInt(a[index], 16) ^ parseInt(b[index], 16)];
  }
  return count;
}

export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumOfSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const response = gray[at - width] + gray[at + width] + gray[at - 1] + gray[at + 1] - 4 * gray[at];
      sum += response;
      sumOfSquares += response * response;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}

export function meanBrightness(gray: Uint8Array): number {
  if (gray.length === 0) return 0;
  let sum = 0;
  for (const value of gray) sum += value;
  return sum / gray.length / 255;
}

export type Measured = {
  id: string;
  hash: string;
  sharpness: number;
  /** When it was taken, or added, in milliseconds. */
  at: number;
};

/** Frames this close, taken this close together, are the same shot taken again. */
export const SIMILAR_BITS = 6;
export const SIMILAR_WINDOW_MS = 10 * 60 * 1000;

/**
 * Groups near-identical photos: a few bits apart and taken within ten minutes
 * of one another (or of another frame in the group). Each group is sharpest
 * first, so its first photo is the one to keep. Singles are left out.
 */
export function similarGroups(items: Measured[], maxBits = SIMILAR_BITS, windowMs = SIMILAR_WINDOW_MS): Measured[][] {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const parent = sorted.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length && sorted[j].at - sorted[i].at <= windowMs; j += 1) {
      if (hammingDistance(sorted[i].hash, sorted[j].hash) <= maxBits) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Measured[]>();
  sorted.forEach((item, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((a, b) => b.sharpness - a.sharpness));
}

/**
 * Photos far softer than the event's own typical photo. Relative, because a
 * dim reception and a sunlit ceremony do not share one idea of "sharp", and
 * conservative: a third of the median, and only once there are enough photos
 * for a median to mean something.
 */
export function blurryPhotos(items: Array<{ id: string; sharpness: number }>, ratio = 0.33, minimum = 12): string[] {
  if (items.length < minimum) return [];
  const sorted = items.map((item) => item.sharpness).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return [];
  return items.filter((item) => item.sharpness < median * ratio).map((item) => item.id);
}

export type TidyCandidate = {
  id: string;
  /** The uploader's hash of the file's bytes: equal means the same file. */
  contentHash: string | null;
  hash: string | null;
  sharpness: number | null;
  /** When it was taken, or added, in milliseconds. */
  at: number;
  /** Pinned into the highlights, which a tidy never hides. */
  pinned: boolean;
};

/** Photos that are one picture: `keep` stays, the rest are offered for hiding. */
export type TidyGroup = { ids: string[]; keep: string; exact: boolean };

/**
 * AI-7: what a tidy would offer to hide. Three kinds, kept apart because a
 * host weighs them differently:
 *
 * - **Exact duplicates**, the same file sent twice, at any distance in time
 *   (the second copy usually arrives through a group chat hours later). The
 *   first to arrive is kept.
 * - **Similar frames**, a burst of the same moment. The sharpest is kept.
 * - **Blurry photos** on their own, far softer than the event's usual.
 *
 * A pinned photo is never offered, and is kept in its group when there is one.
 * A copy is offered once, by its duplicate group; the copy kept can still sit
 * in a burst, where it is weighed against the other frames like any photo.
 */
export function tidyPlan(items: TidyCandidate[]): { groups: TidyGroup[]; blurry: string[] } {
  const groups: TidyGroup[] = [];
  const pinned = new Set(items.filter((item) => item.pinned).map((item) => item.id));
  const keeperOf = (ids: string[]) => ids.find((id) => pinned.has(id)) ?? ids[0];

  const byContent = new Map<string, TidyCandidate[]>();
  for (const item of items) {
    if (!item.contentHash) continue;
    byContent.set(item.contentHash, [...(byContent.get(item.contentHash) ?? []), item]);
  }
  const copies = new Set<string>();
  for (const same of byContent.values()) {
    if (same.length < 2) continue;
    const ids = same.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map((item) => item.id);
    const keep = keeperOf(ids);
    groups.push({ ids: [keep, ...ids.filter((id) => id !== keep)], keep, exact: true });
    for (const id of ids) if (id !== keep) copies.add(id);
  }

  const measured = items.filter(
    (item): item is TidyCandidate & { hash: string; sharpness: number } =>
      item.hash !== null && item.sharpness !== null,
  );
  for (const similar of similarGroups(measured.filter((item) => !copies.has(item.id)))) {
    const ids = similar.map((item) => item.id);
    const keep = keeperOf(ids);
    groups.push({ ids: [keep, ...ids.filter((id) => id !== keep)], keep, exact: false });
  }

  const grouped = new Set(groups.flatMap((group) => group.ids));
  const blurry = blurryPhotos(measured).filter((id) => !grouped.has(id) && !pinned.has(id));
  return { groups, blurry };
}

/** What hiding a group hides: everything but the photo kept and anything pinned. */
export function hiddenBy(group: TidyGroup, keep: string, pinned: ReadonlySet<string>): string[] {
  return group.ids.filter((id) => id !== keep && !pinned.has(id));
}

/** The columns a tidy or a highlight reads from a media row. */
export type ReviewedRow = Pick<
  Media,
  | "id"
  | "kind"
  | "status"
  | "visibility"
  | "guestId"
  | "contentHash"
  | "perceptualHash"
  | "sharpness"
  | "brightness"
  | "reactionCount"
  | "commentCount"
  | "momentId"
  | "capturedAt"
  | "createdAt"
  | "highlight"
>;

/** What guests can see, which is all a tidy offers to hide or a recap shows. */
export function seenByGuests<T extends ReviewedRow>(rows: T[]): T[] {
  return rows.filter((row) => row.status === "approved" && row.visibility === "gallery");
}

/** AI-7: `tidyPlan` over an event's rows, on the same clock as its moments. */
export function tidyFor(rows: ReviewedRow[]) {
  const shown = seenByGuests(rows);
  const offset = wallClockOffsetMinutes(shown);
  return tidyPlan(
    shown.map((row) => ({
      id: row.id,
      contentHash: row.contentHash,
      // Videos are never measured, but a video sent twice is still a copy.
      hash: row.kind === "photo" ? row.perceptualHash : null,
      sharpness: row.kind === "photo" ? row.sharpness : null,
      at: momentTime(row, offset),
      pinned: row.highlight === "pinned",
    })),
  );
}
