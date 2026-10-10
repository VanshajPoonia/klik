import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { events, media } from "./schema";
import { deleteBlobs } from "./storage";
import { MEDIA_OBJECT_COLUMNS, mediaObjectKeys } from "./media-objects";
import { deleteEventExports } from "./exports";
import { deleteEventDesignObjects } from "./print-designs";
import { hasLegalHold } from "./reports";
import { log } from "./observability";

/** How long soft-deleted rows stay recoverable before the bytes go for good. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * SEC-5: erase one event whose 30-day trash has closed, as a job of its own.
 * The nightly purge used to do every such event inline, so a large backlog
 * depended on fitting inside one function's 300 seconds; now it queues one
 * job per event and each runs in its own budget, retried if it is cut short.
 *
 * Idempotent, as every handler must be: an event already gone, restored since,
 * or not yet past its window is left alone. Rows go before bytes, so a failure
 * between the two leaves orphans the reaper sweeps, never rows pointing at
 * nothing. An event holding anything under a legal hold waits, logged.
 */
export async function purgeDeletedEvent(eventId: string): Promise<"purged" | "skipped"> {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        isNotNull(events.deletedAt),
        lte(events.deletedAt, sql`now() - (${TRASH_RETENTION_DAYS}::int * interval '1 day')`),
      ),
    )
    .limit(1);
  if (!event) return "skipped";
  if (await hasLegalHold({ eventIds: [event.id] })) {
    log.warn("purge.skipped_legal_hold", { eventId: event.id });
    return "skipped";
  }
  const rows = await db.select(MEDIA_OBJECT_COLUMNS).from(media).where(eq(media.eventId, event.id));
  // Exports first: deleting the event cascades their rows away, and the rows
  // are the only record of where the ZIPs are.
  await deleteEventExports([event.id]);
  await deleteEventDesignObjects([event.id]);
  await db.delete(events).where(eq(events.id, event.id));
  await deleteBlobs(mediaObjectKeys(rows));
  return "purged";
}
