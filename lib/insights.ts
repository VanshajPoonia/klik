import { and, count, countDistinct, desc, eq, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { db } from "./db";
import { events, guests, media, mediaShares } from "./schema";

/**
 * GRW-7: the numbers that answer "was this worth it". Read from the rows that
 * already exist, plus `events.gallery_opens`. Live media only, matching what
 * the organizer sees in their gallery.
 */

export interface EventInsights {
  galleryOpens: number;
  guestsJoined: number;
  contributors: number;
  photos: number;
  videos: number;
  shareOpens: number;
  /** Upload counts per bucket, oldest first. `bucket` is an ISO instant. */
  timeline: Array<{ bucket: string; uploads: number }>;
  bucketSize: "hour" | "day";
  topContributors: Array<{ name: string; uploads: number }>;
  /** MED-9: hearts and visible comments across live media. */
  hearts: number;
  comments: number;
  /** The most hearted, most first, for "guests' favourites". */
  mostLoved: Array<{ id: string; kind: "photo" | "video"; hearts: number; comments: number }>;
}

const MOST_LOVED = 6;

/** Hourly up to three days of activity, then daily, so the chart stays readable. */
const HOURLY_SPAN_HOURS = 72;

export async function eventInsights(eventId: string): Promise<EventInsights> {
  const live = and(eq(media.eventId, eventId), isNull(media.deletedAt));
  const [[event], [joined], [uploads], [shares], span] = await Promise.all([
    db.select({ galleryOpens: events.galleryOpens }).from(events).where(eq(events.id, eventId)).limit(1),
    db.select({ value: count() }).from(guests).where(eq(guests.eventId, eventId)),
    db
      .select({
        photos: sql<number>`count(*) filter (where ${media.kind} = 'photo')`.mapWith(Number),
        videos: sql<number>`count(*) filter (where ${media.kind} = 'video')`.mapWith(Number),
        contributors: countDistinct(media.guestId),
        hearts: sql<number>`coalesce(sum(${media.reactionCount}), 0)`.mapWith(Number),
        comments: sql<number>`coalesce(sum(${media.commentCount}), 0)`.mapWith(Number),
      })
      .from(media)
      .where(live),
    db.select({ value: sum(mediaShares.viewCount).mapWith(Number) }).from(mediaShares).where(eq(mediaShares.eventId, eventId)),
    db
      .select({
        first: sql<string | null>`min(${media.createdAt})`,
        last: sql<string | null>`max(${media.createdAt})`,
      })
      .from(media)
      .where(live),
  ]);

  const first = span[0]?.first ? new Date(span[0].first) : null;
  const last = span[0]?.last ? new Date(span[0].last) : null;
  const hours = first && last ? (last.getTime() - first.getTime()) / 3_600_000 : 0;
  const bucketSize = hours > HOURLY_SPAN_HOURS ? "day" : "hour";
  // A literal, not a parameter: as a parameter it is $1 in SELECT and $3 in
  // GROUP BY, and Postgres will not treat those as the same expression. Safe,
  // because it is one of two fixed words, never input.
  const bucket = sql`date_trunc(${sql.raw(bucketSize === "day" ? "'day'" : "'hour'")}, ${media.createdAt})`;

  const [timelineRows, contributorRows, lovedRows] = await Promise.all([
    db
      .select({ bucket: sql<string>`${bucket}`, uploads: count() })
      .from(media)
      .where(live)
      .groupBy(bucket)
      .orderBy(bucket),
    db
      .select({ name: guests.displayName, uploads: count() })
      .from(media)
      .innerJoin(guests, eq(guests.id, media.guestId))
      .where(and(live, isNotNull(media.guestId)))
      .groupBy(guests.id, guests.displayName)
      .orderBy(desc(count()))
      .limit(5),
    db
      .select({ id: media.id, kind: media.kind, hearts: media.reactionCount, comments: media.commentCount })
      .from(media)
      .where(and(live, sql`${media.reactionCount} > 0`))
      .orderBy(desc(media.reactionCount), desc(media.createdAt))
      .limit(MOST_LOVED),
  ]);

  return {
    galleryOpens: event?.galleryOpens ?? 0,
    guestsJoined: joined?.value ?? 0,
    contributors: uploads?.contributors ?? 0,
    photos: uploads?.photos ?? 0,
    videos: uploads?.videos ?? 0,
    shareOpens: shares?.value ?? 0,
    timeline: fillGaps(
      timelineRows.map((row) => ({ bucket: new Date(row.bucket).toISOString(), uploads: row.uploads })),
      bucketSize,
    ),
    bucketSize,
    topContributors: contributorRows.map((row) => ({ name: row.name?.trim() || "A guest", uploads: row.uploads })),
    hearts: uploads?.hearts ?? 0,
    comments: uploads?.comments ?? 0,
    mostLoved: lovedRows,
  };
}

/**
 * Fills the quiet hours between busy ones with zeros. A chart that skips empty
 * buckets draws the 2am lull and the 9pm rush next to each other, which is
 * exactly the shape it exists to show.
 */
export function fillGaps(
  rows: Array<{ bucket: string; uploads: number }>,
  size: "hour" | "day",
): Array<{ bucket: string; uploads: number }> {
  if (rows.length < 2) return rows;
  const step = size === "hour" ? 3_600_000 : 86_400_000;
  const byTime = new Map(rows.map((row) => [new Date(row.bucket).getTime(), row.uploads]));
  const start = new Date(rows[0].bucket).getTime();
  const end = new Date(rows[rows.length - 1].bucket).getTime();
  const filled: Array<{ bucket: string; uploads: number }> = [];
  for (let at = start; at <= end; at += step) {
    filled.push({ bucket: new Date(at).toISOString(), uploads: byTime.get(at) ?? 0 });
  }
  return filled;
}

/** Counts one gallery open. Called after the response, never awaited by a guest. */
export async function countGalleryOpen(eventId: string): Promise<void> {
  await db
    .update(events)
    .set({ galleryOpens: sql`${events.galleryOpens} + 1` })
    .where(eq(events.id, eventId));
}
