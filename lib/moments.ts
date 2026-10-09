/**
 * AI-1: moments and bursts, from time alone. No model, no cost.
 *
 * **Moments** cut an event's photos wherever there is a long enough quiet
 * spell: getting ready, the ceremony, dinner, the dance floor. **Bursts** are
 * five or more shots one person took inside ten seconds, which a gallery shows
 * as one photo with a count.
 *
 * Pure, so the job that stores the result and the tests share one rule.
 *
 * **Which clock.** A photo's EXIF capture time (`media.captured_at`) is a wall
 * clock with no zone, and its upload time (`created_at`) is an instant. They
 * cannot be compared directly: an evening wedding in New York uploads at a UTC
 * hour five ahead of what every camera in the room says. So the event's offset
 * is estimated from the photos that have both, as the median of upload minus
 * capture, rounded to a quarter hour, and photos without a capture time are
 * placed on the wall clock by taking that offset off their upload time. Most
 * photos are uploaded within minutes of being taken, so the median is the zone
 * plus a little delay, and the rounding takes off the delay.
 *
 * Bursts use capture times only. Upload times bunch for a reason that has
 * nothing to do with shooting: thirty photos picked from a camera roll arrive
 * in the same few seconds.
 */

export interface MomentInput {
  id: string;
  /** The uploading guest; null for the team. Bursts are per person. */
  guestId: string | null;
  /** `YYYY-MM-DD HH:MM:SS` (or with a T) wall time, or null. */
  capturedAt: string | null;
  createdAt: Date | string;
}

export interface Moment {
  /** Wall-clock milliseconds, read as if UTC. */
  start: number;
  end: number;
  ids: string[];
}

export const MOMENT_GAP_FLOOR_MS = 20 * 60_000;
/** The threshold also scales with how sparse the event is: this many typical gaps. */
export const MOMENT_GAP_MULTIPLE = 6;
export const MAX_MOMENTS = 12;
/** A moment smaller than this joins its nearer neighbour, if that one is close. */
export const MIN_MOMENT_SIZE = 3;
const MERGE_WITHIN_MS = 3 * 60 * 60_000;
export const BURST_WINDOW_MS = 10_000;
export const BURST_MIN = 5;

/** A wall time string as milliseconds, read as UTC. Null when it is not one. */
export function wallMs(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isNaN(ms) ? null : ms;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Minutes to take off an upload time to put it on the event's wall clock.
 * Zero when nothing has a capture time, in which case every photo is on the
 * upload clock and they agree with each other anyway.
 */
export function wallClockOffsetMinutes(items: MomentInput[]): number {
  const diffs: number[] = [];
  for (const item of items) {
    const captured = wallMs(item.capturedAt);
    if (captured === null) continue;
    diffs.push(new Date(item.createdAt).getTime() - captured);
  }
  if (diffs.length === 0) return 0;
  const minutes = Math.round(median(diffs) / 60_000 / 15) * 15;
  // Real zones run from -12 to +14. Anything past that is cameras with the
  // wrong clock, and trusting it would move every upload-timed photo too.
  return Math.abs(minutes) <= 14 * 60 ? minutes : 0;
}

/** Where a photo sits on the wall clock. */
export function momentTime(item: MomentInput, offsetMinutes: number): number {
  return wallMs(item.capturedAt) ?? new Date(item.createdAt).getTime() - offsetMinutes * 60_000;
}

function split(sorted: Array<{ id: string; t: number }>, threshold: number): Moment[] {
  const moments: Moment[] = [];
  for (const item of sorted) {
    const last = moments[moments.length - 1];
    if (last && item.t - last.end <= threshold) {
      last.end = item.t;
      last.ids.push(item.id);
    } else {
      moments.push({ start: item.t, end: item.t, ids: [item.id] });
    }
  }
  return moments;
}

/** Folds moments that are too small into whichever neighbour is nearer, if near. */
function mergeSmall(moments: Moment[]): Moment[] {
  const out = moments.map((moment) => ({ ...moment, ids: [...moment.ids] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < out.length; index += 1) {
      const moment = out[index];
      if (moment.ids.length >= MIN_MOMENT_SIZE || out.length === 1) continue;
      const before = out[index - 1];
      const after = out[index + 1];
      const gapBefore = before ? moment.start - before.end : Infinity;
      const gapAfter = after ? after.start - moment.end : Infinity;
      const nearer = gapBefore <= gapAfter ? before : after;
      if (!nearer || Math.min(gapBefore, gapAfter) > MERGE_WITHIN_MS) continue;
      nearer.start = Math.min(nearer.start, moment.start);
      nearer.end = Math.max(nearer.end, moment.end);
      nearer.ids.push(...moment.ids);
      out.splice(index, 1);
      changed = true;
      break;
    }
  }
  return out;
}

export function clusterMoments(items: MomentInput[]): { offsetMinutes: number; moments: Moment[] } {
  const offsetMinutes = wallClockOffsetMinutes(items);
  const sorted = items
    .map((item) => ({ id: item.id, t: momentTime(item, offsetMinutes) }))
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  if (sorted.length === 0) return { offsetMinutes, moments: [] };

  const gaps = sorted.slice(1).map((item, index) => item.t - sorted[index].t);
  let threshold = Math.max(MOMENT_GAP_FLOOR_MS, gaps.length ? median(gaps) * MOMENT_GAP_MULTIPLE : 0);
  let moments = mergeSmall(split(sorted, threshold));
  // A day-long festival should not become forty tabs. Widen until it fits.
  while (moments.length > MAX_MOMENTS) {
    threshold *= 1.5;
    moments = mergeSmall(split(sorted, threshold));
  }
  return { offsetMinutes, moments };
}

/**
 * Bursts, as member id to the burst's first photo, which stands for it. Only
 * photos with a capture time, grouped by who took them.
 */
export function findBursts(items: MomentInput[]): Map<string, string> {
  const byPerson = new Map<string, Array<{ id: string; t: number }>>();
  for (const item of items) {
    const t = wallMs(item.capturedAt);
    if (t === null) continue;
    const key = item.guestId ?? "team";
    const list = byPerson.get(key) ?? [];
    list.push({ id: item.id, t });
    byPerson.set(key, list);
  }
  const bursts = new Map<string, string>();
  for (const list of byPerson.values()) {
    list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    let index = 0;
    while (index < list.length) {
      let end = index;
      while (end + 1 < list.length && list[end + 1].t - list[index].t <= BURST_WINDOW_MS) end += 1;
      if (end - index + 1 >= BURST_MIN) {
        for (let at = index; at <= end; at += 1) bursts.set(list[at].id, list[index].id);
        index = end + 1;
      } else {
        index += 1;
      }
    }
  }
  return bursts;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

function partOfDay(ms: number): string {
  const hour = new Date(ms).getUTCHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * Names for a run of moments: "Afternoon", or "Saturday evening" when the
 * event spans days, with the start time added where two would read the same.
 * The host renames them to "Ceremony" and "First dance"; these only have to
 * be clear until then.
 */
export function momentNames(moments: Array<Pick<Moment, "start">>): string[] {
  const days = new Set(moments.map((moment) => new Date(moment.start).toISOString().slice(0, 10)));
  const base = moments.map((moment) => {
    const part = partOfDay(moment.start);
    return days.size > 1 ? `${WEEKDAY.format(moment.start)} ${part}` : part[0].toUpperCase() + part.slice(1);
  });
  return base.map((name, index) =>
    base.filter((other) => other === name).length > 1 ? `${name}, ${CLOCK.format(moments[index].start)}` : name,
  );
}
