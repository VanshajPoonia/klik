import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "./db";
import { media } from "./schema";
import { decodeMediaCursor } from "./media-cursor";

export interface FetchGalleryOptions {
  isOwner: boolean;
  guestId?: string | null;
  cursor?: string | null;
  /**
   * Mutually exclusive with cursor: returns every row newer than this
   * timestamp instead of paging older ones. Lets a client that has already
   * paged through history poll for new arrivals without leaving a gap - a
   * fixed-size "top N" poll would otherwise stop covering whichever row
   * new uploads pushed just past its window.
   */
  since?: string | null;
  limit?: number;
}

// Bounds one response when polling "since a cursor". Since-mode reads the
// oldest unseen rows first, then reverses them for display, so a burst larger
// than the cap is drained across polls without skipping its middle.
const SINCE_SAFETY_CAP = 300;

/** Single source of truth for "which media rows can this viewer see," shared
 * by the guest gallery API route and the guest page's initial server render. */
export async function fetchGalleryMedia(eventId: string, options: FetchGalleryOptions) {
  const { isOwner, guestId, cursor, since, limit = 50 } = options;
  // Soft-deleted rows are excluded for everyone, owners included. They exist
  // only so the 30-day recovery window in the purge cron has something to
  // restore from, and a deleted photo reappearing in a gallery would defeat
  // the point of deleting it.
  const conditions = [eq(media.eventId, eventId), isNull(media.deletedAt)];
  const sinceCursor = since ? decodeMediaCursor(since) : null;
  const pageCursor = cursor ? decodeMediaCursor(cursor) : null;
  if (sinceCursor) {
    conditions.push(
      sinceCursor.id
        ? or(
            gt(media.createdAt, sinceCursor.createdAt),
            and(eq(media.createdAt, sinceCursor.createdAt), gt(media.id, sinceCursor.id)),
          )!
        : gt(media.createdAt, sinceCursor.createdAt),
    );
  } else if (pageCursor) {
    conditions.push(
      pageCursor.id
        ? or(
            lt(media.createdAt, pageCursor.createdAt),
            and(eq(media.createdAt, pageCursor.createdAt), lt(media.id, pageCursor.id)),
          )!
        : lt(media.createdAt, pageCursor.createdAt),
    );
  }

  const visibilityFilter = isOwner
    ? undefined // owner sees every status (for moderation/preview)
    : guestId
      ? or(eq(media.status, "approved"), eq(media.guestId, guestId))
      : eq(media.status, "approved");

  const rows = await db
    .select()
    .from(media)
    .where(visibilityFilter ? and(...conditions, visibilityFilter) : and(...conditions))
    .orderBy(
      since ? asc(media.createdAt) : desc(media.createdAt),
      since ? asc(media.id) : desc(media.id),
    )
    .limit(since ? SINCE_SAFETY_CAP : limit);

  const orderedRows = since ? rows.reverse() : rows;
  return orderedRows.map((row) => ({
    ...row,
    mine: guestId != null && row.guestId === guestId,
  }));
}
