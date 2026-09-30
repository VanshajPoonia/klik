import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, guests, media, venueClients } from "@/lib/schema";
import { deleteBlobs } from "@/lib/storage";
import { pruneRateLimits } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * A purge is irreversible, so this route treats an unexpectedly large batch as
 * a configuration error rather than a real backlog. Deleting a few galleries a
 * night is normal. Deleting most of the platform in one run means something
 * upstream changed retention for everyone at once, which is exactly what a bad
 * migration looks like, and it should stop rather than proceed.
 */
const MAX_PURGES_PER_RUN = 25;
const RUNAWAY_RATIO = 0.5;

/** A video's poster is a separate object, so it has to be named explicitly or
 *  the thumbnail outlives the video it described. */
function withPosters(rows: Array<{ pathname: string; poster: string | null }>): string[] {
  return [
    ...rows.map((row) => row.pathname),
    ...rows.map((row) => row.poster).filter((path): path is string => Boolean(path)),
  ];
}

/** How long soft-deleted rows stay recoverable before the bytes go for good. */
const TRASH_RETENTION_DAYS = 30;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const trashCutoff = sql`now() - (${TRASH_RETENTION_DAYS}::int * interval '1 day')`;

  // --- Pass 1: soft-deleted rows whose recovery window has closed -----------
  // These were already removed from every user-facing surface when they were
  // soft-deleted; this is only the point where the bytes stop existing.
  const expiredTrash = await db
    .select({ id: media.id, pathname: media.blobPathname, poster: media.posterPathname })
    .from(media)
    .where(and(isNotNull(media.deletedAt), lte(media.deletedAt, trashCutoff)));

  if (expiredTrash.length > 0) {
    await db.delete(media).where(and(isNotNull(media.deletedAt), lte(media.deletedAt, trashCutoff)));
    await deleteBlobs(withPosters(expiredTrash));
  }

  // Albums and venue clients hold no objects, so they are a plain delete once
  // their window closes. Media keeps its album_id pointer until this runs,
  // which is what makes an album restore put the photos back where they were.
  await db
    .delete(albums)
    .where(and(isNotNull(albums.deletedAt), lte(albums.deletedAt, trashCutoff)));
  await db
    .delete(venueClients)
    .where(and(isNotNull(venueClients.deletedAt), lte(venueClients.deletedAt, trashCutoff)));

  // Guest personal data outlives the media only until the grace window closes.
  // It cannot go at the retention step any more, because media there is
  // recoverable for 30 days and restoring photos without guest rows would lose
  // their attribution. Once the bytes are genuinely gone, so is the reason to
  // keep a display name and a consent record.
  await db.delete(guests).where(
    inArray(
      guests.eventId,
      db
        .select({ id: events.id })
        .from(events)
        .where(and(isNotNull(events.purgedAt), lte(events.purgedAt, trashCutoff))),
    ),
  );

  const expiredDeletedEvents = await db
    .select({ id: events.id })
    .from(events)
    .where(and(isNotNull(events.deletedAt), lte(events.deletedAt, trashCutoff)));

  for (const event of expiredDeletedEvents) {
    const rows = await db
      .select({ pathname: media.blobPathname, poster: media.posterPathname })
      .from(media)
      .where(eq(media.eventId, event.id));
    await db.delete(events).where(eq(events.id, event.id));
    await deleteBlobs(withPosters(rows));
  }

  // --- Pass 2: events past their pinned retention deadline ------------------
  // retention_until is written once at creation and only ever extended, so it
  // cannot be shortened retroactively by a plan change. Rows predating the
  // column have it null and are skipped rather than defaulted, because a null
  // here means "we do not know", and "we do not know" must never resolve to
  // "delete it". See ROADMAP.md SEC-1.
  const candidates = await db
    .select({ id: events.id })
    .from(events)
    .where(and(isNull(events.purgedAt), isNull(events.deletedAt)));

  const expired = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        isNull(events.purgedAt),
        isNull(events.deletedAt),
        isNotNull(events.retentionUntil),
        lte(events.retentionUntil, now),
      ),
    );

  if (
    candidates.length > 0 &&
    expired.length > MAX_PURGES_PER_RUN &&
    expired.length / candidates.length > RUNAWAY_RATIO
  ) {
    console.error(
      `Purge aborted: ${expired.length} of ${candidates.length} events are eligible, ` +
        "which looks like a retention misconfiguration rather than a backlog.",
    );
    return NextResponse.json(
      {
        error: "Purge aborted, eligible count looks like a misconfiguration",
        eligible: expired.length,
        total: candidates.length,
      },
      { status: 500 },
    );
  }

  const batch = expired.slice(0, MAX_PURGES_PER_RUN);
  let mediaDeleted = 0;
  const failures: string[] = [];

  for (const event of batch) {
    try {
      // Reaching a retention deadline soft-deletes; it does not destroy. The
      // gallery empties immediately, which is the promised outcome, but the
      // bytes survive the same 30 days as any other deletion and pass 1 above
      // finishes the job on the next run after that.
      //
      // This used to hard-delete, so an event crossing its deadline at 3am lost
      // every photo with no grace and no recovery. That is a bad way to find
      // out a retention window was miscalculated, which is precisely the
      // failure SEC-1 was about.
      const softDeleted = await db
        .update(media)
        .set({ deletedAt: now })
        .where(and(eq(media.eventId, event.id), isNull(media.deletedAt)))
        .returning({ id: media.id });

      await db
        .update(events)
        .set({
          coverMediaId: null,
          isActive: false,
          uploadsEnabled: false,
          purgedAt: now,
          updatedAt: now,
        })
        .where(eq(events.id, event.id));

      mediaDeleted += softDeleted.length;
    } catch (error) {
      failures.push(event.id);
      console.error("Could not purge expired event", event.id, error);
    }
  }

  await pruneRateLimits();

  return NextResponse.json({
    eventsPurged: batch.length - failures.length,
    mediaDeleted,
    trashedMediaRemoved: expiredTrash.length,
    trashedEventsRemoved: expiredDeletedEvents.length,
    failures: failures.length,
    deferred: expired.length - batch.length,
  });
}
