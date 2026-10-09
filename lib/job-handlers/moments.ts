import { and, eq, gt, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import { albums, media } from "../schema";
import { clusterMoments, findBursts, momentNames, type Moment } from "../moments";
import { touchEvent } from "../folders";
import { enqueueMomentsRefresh, type JobPayload } from "../jobs";
import { log, reportError } from "../observability";
import type { JobOutcome } from "../job-runner";

/**
 * AI-1: works out an event's moments and bursts and stores them, so a gallery
 * reads two columns rather than clustering on every page load.
 *
 * A moment is an `albums` row of kind `smart`, with its span in `query`. Each
 * run matches the new moments to the stored ones by how much their spans
 * overlap, so a moment keeps its id, and a host who renamed "Afternoon" to
 * "Ceremony" keeps that name, as photos keep arriving.
 *
 * Idempotent, and cheap: one read of the event's capture times, and writes
 * only for rows whose moment or burst actually changed.
 */

export interface MomentQuery {
  type: "moment";
  start: number;
  end: number;
  /** The host named it, so a refresh keeps the name. */
  renamed?: boolean;
}

export function isMomentQuery(query: unknown): query is MomentQuery {
  return Boolean(query && typeof query === "object" && (query as { type?: unknown }).type === "moment");
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) +
  // Zero-length spans (a moment of one instant) still count as touching.
  (a.start <= b.end && b.start <= a.end ? 1 : 0);

export async function refreshMoments(payload: JobPayload<"moments.refresh">): Promise<JobOutcome> {
  const { eventId } = payload;
  const rows = await db
    .select({
      id: media.id,
      guestId: media.guestId,
      capturedAt: media.capturedAt,
      createdAt: media.createdAt,
      momentId: media.momentId,
      burstId: media.burstId,
    })
    .from(media)
    .where(and(eq(media.eventId, eventId), isNull(media.deletedAt)));
  const newest = rows.reduce((latest, row) => Math.max(latest, row.createdAt.getTime()), 0);

  const { moments: found } = clusterMoments(rows);
  // One moment is no grouping at all; it would only be a tab saying "all".
  const moments: Moment[] = found.length >= 2 ? found : [];
  const bursts = findBursts(rows);

  const stored = (
    await db
      .select({ id: albums.id, name: albums.name, query: albums.query })
      .from(albums)
      .where(and(eq(albums.eventId, eventId), eq(albums.kind, "smart"), isNull(albums.deletedAt)))
  ).filter((row) => isMomentQuery(row.query)) as Array<{ id: string; name: string; query: MomentQuery }>;

  // Greedy by overlap, biggest first, so each stored moment goes to the new one
  // that is most nearly the same span.
  const pairs: Array<{ index: number; storedId: string; score: number }> = [];
  moments.forEach((moment, index) => {
    for (const row of stored) {
      const score = overlap(moment, row.query);
      if (score > 0) pairs.push({ index, storedId: row.id, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const matched = new Map<number, string>();
  const used = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.index) || used.has(pair.storedId)) continue;
    matched.set(pair.index, pair.storedId);
    used.add(pair.storedId);
  }

  const names = momentNames(moments);
  const momentIds: string[] = [];
  let changed = false;
  for (const [index, moment] of moments.entries()) {
    const storedId = matched.get(index);
    const previous = stored.find((row) => row.id === storedId);
    const query: MomentQuery = {
      type: "moment",
      start: moment.start,
      end: moment.end,
      ...(previous?.query.renamed ? { renamed: true } : {}),
    };
    const name = previous?.query.renamed ? previous.name : names[index];
    if (previous) {
      if (previous.name !== name || previous.query.start !== query.start || previous.query.end !== query.end) {
        await db.update(albums).set({ name, query, position: index }).where(eq(albums.id, previous.id));
        changed = true;
      }
      momentIds.push(previous.id);
    } else {
      const id = nanoid();
      await db.insert(albums).values({ id, eventId, name, kind: "smart", query, position: index });
      momentIds.push(id);
      changed = true;
    }
  }

  const gone = stored.filter((row) => !used.has(row.id)).map((row) => row.id);
  if (gone.length > 0) {
    // Hard, not soft: a moment is derived, holds no photos by itself, and its
    // only pointers are media.moment_id, which the foreign key clears.
    await db.delete(albums).where(inArray(albums.id, gone));
    changed = true;
  }

  // Photos: only the rows whose moment moved, one statement per moment.
  const want = new Map<string, string | null>(rows.map((row) => [row.id, null]));
  moments.forEach((moment, index) => moment.ids.forEach((id) => want.set(id, momentIds[index])));
  const byMoment = new Map<string | null, string[]>();
  for (const row of rows) {
    const target = want.get(row.id) ?? null;
    if (row.momentId === target) continue;
    byMoment.set(target, [...(byMoment.get(target) ?? []), row.id]);
  }
  for (const [momentId, ids] of byMoment) {
    await db.update(media).set({ momentId }).where(and(eq(media.eventId, eventId), inArray(media.id, ids)));
    changed = true;
  }

  const byBurst = new Map<string | null, string[]>();
  for (const row of rows) {
    const target = bursts.get(row.id) ?? null;
    if (row.burstId === target) continue;
    byBurst.set(target, [...(byBurst.get(target) ?? []), row.id]);
  }
  for (const [burstId, ids] of byBurst) {
    await db.update(media).set({ burstId }).where(and(eq(media.eventId, eventId), inArray(media.id, ids)));
    changed = true;
  }

  // Open galleries resync and pick up the new grouping with the media.
  if (changed) await touchEvent(eventId);
  log.info("moments.refreshed", { eventId, moments: moments.length, bursts: new Set(bursts.values()).size, changed });

  // A photo that arrived while this ran found the job already running, so its
  // own enqueue was collapsed into this one. Go round once more for it.
  const [latest] = await db
    .select({ newest: max(media.createdAt) })
    .from(media)
    .where(and(eq(media.eventId, eventId), isNull(media.deletedAt)));
  if (latest?.newest && latest.newest.getTime() > newest) return { requeue: { delayMs: 5_000 } };
  return;
}

/**
 * The daily backstop: every event with media from the last three days, which
 * catches anything a kick missed, capture times the video scrub found later,
 * and photos deleted since the last run.
 */
export async function backfillMoments(): Promise<JobOutcome> {
  const rows = await db
    .selectDistinct({ eventId: media.eventId })
    .from(media)
    .where(and(gt(media.changedAt, sql`now() - interval '3 days'`), isNotNull(media.eventId)))
    .limit(500);
  for (const { eventId } of rows) {
    await enqueueMomentsRefresh(eventId).catch((error) => reportError("moments.enqueue_failed", error, { eventId }));
  }
  return;
}
