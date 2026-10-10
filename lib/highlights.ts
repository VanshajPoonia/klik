import { blurryPhotos, hammingDistance, seenByGuests, SIMILAR_BITS, similarGroups, type ReviewedRow } from "./image-analysis";
import { momentTime, wallClockOffsetMinutes } from "./moments";

/**
 * AI-8 without a model: the photos that tell the story of an event. Client
 * safe and pure, so the dashboard shows exactly what a recap (GRW-1) sends.
 *
 * Each measured photo gets a score from three things a person would notice:
 * how sharp it is next to the rest of the event, whether it is lit well
 * enough to see, and how much guests loved it (hearts, and comments counted
 * double, since writing one costs more than a tap). Then a selection that
 * spreads itself across the night: each photo already picked from a moment
 * makes the next one from that moment worth less, and a photo that looks
 * like one already chosen is worth less again.
 *
 * The host has the last word. A pinned photo is always in, whatever it
 * scored; an excluded one never is.
 */

export const HIGHLIGHT_COUNT = 20;

export type HighlightCandidate = {
  id: string;
  /** The uploader's hash of the file: equal means the same file sent again. */
  contentHash?: string | null;
  hash: string | null;
  sharpness: number | null;
  brightness: number | null;
  hearts: number;
  comments: number;
  /** AI-1's moment, when the event has them. */
  momentId: string | null;
  /** When it was taken, or added, in milliseconds. */
  at: number;
  highlight: "pinned" | "excluded" | null;
};

const WEIGHTS = { sharpness: 0.45, exposure: 0.25, love: 0.3 };
/** What each photo already picked from a moment does to the next one's worth. */
const SAME_MOMENT = 0.55;
/** And a photo that looks like one already picked. */
const LOOKS_PICKED = 0.5;
const LOOKS_PICKED_BITS = 10;
/** Without AI-1's moments, the night is cut into spans this long instead. */
const FALLBACK_SPAN_MS = 30 * 60 * 1000;

/** 1 across a comfortable range, falling to 0 at nearly black or nearly white. */
export function exposureScore(brightness: number | null): number {
  if (brightness === null) return 0.5;
  if (brightness < 0.3) return Math.max(0, (brightness - 0.05) / 0.25);
  if (brightness > 0.7) return Math.max(0, (0.95 - brightness) / 0.25);
  return 1;
}

export function scoreHighlights(items: HighlightCandidate[]): Map<string, number> {
  const measured = items.filter((item) => item.sharpness !== null);
  const sharpnesses = measured.map((item) => item.sharpness as number).sort((a, b) => a - b);
  // How many of the event's photos are softer than this one, as a share.
  const percentile = (value: number) => {
    if (sharpnesses.length < 2) return 1;
    let low = 0;
    let high = sharpnesses.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sharpnesses[middle] < value) low = middle + 1;
      else high = middle;
    }
    return low / (sharpnesses.length - 1);
  };
  const love = (item: HighlightCandidate) => item.hearts + 2 * item.comments;
  const mostLoved = Math.max(0, ...items.map(love));

  const scores = new Map<string, number>();
  for (const item of measured) {
    const loved = mostLoved > 0 ? Math.log1p(love(item)) / Math.log1p(mostLoved) : 0;
    scores.set(
      item.id,
      WEIGHTS.sharpness * percentile(item.sharpness as number) +
        WEIGHTS.exposure * exposureScore(item.brightness) +
        WEIGHTS.love * loved,
    );
  }
  return scores;
}

export type HighlightSelection = {
  /** In the order they were taken, which is the order a recap tells them in. */
  picks: string[];
  /** The best of the rest, for a host looking for one more. */
  runnersUp: string[];
};

export function pickHighlights(items: HighlightCandidate[], count = HIGHLIGHT_COUNT): HighlightSelection {
  const scores = scoreHighlights(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const pinned = items.filter((item) => item.highlight === "pinned");

  // Who may be picked by score: measured, not excluded, not pinned (already
  // in), lit well enough to see, not blurry, and the best of its burst.
  const measured = items.filter((item) => scores.has(item.id) && item.highlight !== "excluded");
  const blurry = new Set(
    blurryPhotos(measured.map((item) => ({ id: item.id, sharpness: item.sharpness as number }))),
  );
  const outshone = new Set<string>();
  const hashed = measured.filter((item): item is HighlightCandidate & { hash: string } => item.hash !== null);
  for (const burst of similarGroups(
    hashed.map((item) => ({ id: item.id, hash: item.hash, sharpness: item.sharpness as number, at: item.at })),
  )) {
    const best = burst.reduce((a, b) => ((scores.get(b.id) ?? 0) > (scores.get(a.id) ?? 0) ? b : a));
    for (const frame of burst) if (frame.id !== best.id) outshone.add(frame.id);
  }
  // A file sent twice is one photo, however far apart the copies arrived: the
  // pinned copy if there is one, else the first.
  const copyKept = new Map<string, string>();
  for (const item of [...items].sort((a, b) => Number(b.highlight === "pinned") - Number(a.highlight === "pinned") || a.at - b.at)) {
    if (item.contentHash && !copyKept.has(item.contentHash)) copyKept.set(item.contentHash, item.id);
  }
  const eligible = measured.filter(
    (item) =>
      item.highlight !== "pinned" &&
      !blurry.has(item.id) &&
      !outshone.has(item.id) &&
      (!item.contentHash || copyKept.get(item.contentHash) === item.id) &&
      exposureScore(item.brightness) > 0,
  );

  const moment = (item: HighlightCandidate) => item.momentId ?? `span:${Math.floor(item.at / FALLBACK_SPAN_MS)}`;
  const chosen: HighlightCandidate[] = [...pinned];
  const fromMoment = new Map<string, number>();
  for (const item of pinned) fromMoment.set(moment(item), (fromMoment.get(moment(item)) ?? 0) + 1);

  const remaining = new Set(eligible.map((item) => item.id));
  while (chosen.length < count && remaining.size > 0) {
    let best: HighlightCandidate | null = null;
    let bestWorth = -1;
    for (const id of remaining) {
      const item = byId.get(id) as HighlightCandidate;
      let worth = (scores.get(id) ?? 0) * SAME_MOMENT ** (fromMoment.get(moment(item)) ?? 0);
      const closest = item.hash
        ? Math.min(64, ...chosen.map((other) => (other.hash ? hammingDistance(item.hash as string, other.hash) : 64)))
        : 64;
      // The same picture as one already in, at any distance in time, is out.
      if (closest <= SIMILAR_BITS) continue;
      if (closest <= LOOKS_PICKED_BITS) worth *= LOOKS_PICKED;
      if (worth > bestWorth || (worth === bestWorth && best && item.at < best.at)) {
        best = item;
        bestWorth = worth;
      }
    }
    if (!best) break;
    chosen.push(best);
    remaining.delete(best.id);
    fromMoment.set(moment(best), (fromMoment.get(moment(best)) ?? 0) + 1);
  }

  const runnersUp = [...remaining]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
    .slice(0, 12);
  return {
    picks: chosen.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map((item) => item.id),
    runnersUp,
  };
}

/**
 * `pickHighlights` over an event's rows. Only what guests can see, since a
 * recap goes to guests: a pinned photo the host later hid is not in it. Photos
 * by score, and a pinned video too, because the host asked for it.
 */
export function highlightsFor(rows: ReviewedRow[], count = HIGHLIGHT_COUNT): HighlightSelection {
  const shown = seenByGuests(rows).filter((row) => row.kind === "photo" || row.highlight === "pinned");
  const offset = wallClockOffsetMinutes(shown);
  return pickHighlights(
    shown.map((row) => ({
      id: row.id,
      contentHash: row.contentHash,
      hash: row.perceptualHash,
      sharpness: row.sharpness,
      brightness: row.brightness,
      hearts: row.reactionCount,
      comments: row.commentCount,
      momentId: row.momentId,
      at: momentTime(row, offset),
      highlight: row.highlight,
    })),
    count,
  );
}
