import { and, asc, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "./db";
import { media } from "./schema";
import { decodeMediaCursor } from "./media-cursor";
import { mediaVisibilityFilter, type MediaAccessEvent } from "./media-access";

export interface FetchGalleryOptions {
  isOwner: boolean;
  guestId?: string | null;
  /**
   * The event's own access settings. Required rather than optional on purpose:
   * defaulting it would mean a caller who forgot it silently gets whichever
   * behaviour the default happened to be, and one of those answers leaks
   * private photos.
   */
  event: MediaAccessEvent;
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
  /** CAM-3: just this row, for a link that opens one photo. Same rule. */
  id?: string;
}

// Bounds one response when polling "since a cursor". Since-mode reads the
// oldest unseen rows first, then reverses them for display, so a burst larger
// than the cap is drained across polls without skipping its middle.
const SINCE_SAFETY_CAP = 300;

/** Single source of truth for "which media rows can this viewer see," shared
 * by the guest gallery API route and the guest page's initial server render. */
export async function fetchGalleryMedia(eventId: string, options: FetchGalleryOptions) {
  const { isOwner, guestId, event, cursor, since, limit = 50, id } = options;
  // Soft-deleted rows are excluded for everyone, owners included. They exist
  // only so the 30-day recovery window in the purge cron has something to
  // restore from, and a deleted photo reappearing in a gallery would defeat
  // the point of deleting it.
  const conditions = [eq(media.eventId, eventId), isNull(media.deletedAt)];
  if (id) conditions.push(eq(media.id, id));
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

  // Status and visibility are decided together in lib/media-access.ts, which
  // also expresses the same rule as a boolean for the content route. Keeping
  // both there is what stops the grid and the direct URL disagreeing.
  const visibilityFilter = mediaVisibilityFilter({ isManager: isOwner, guestId: guestId ?? null }, event);

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
