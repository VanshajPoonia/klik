import { and, desc, eq, gt, lt, or } from "drizzle-orm";
import { db } from "./db";
import { media } from "./schema";

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

// Bounds the response when polling "since a cursor" (no caller-supplied
// limit applies there): normal upload bursts are nowhere near this size.
const SINCE_SAFETY_CAP = 300;

/** Single source of truth for "which media rows can this viewer see," shared
 * by the guest gallery API route and the guest page's initial server render. */
export async function fetchGalleryMedia(eventId: string, options: FetchGalleryOptions) {
  const { isOwner, guestId, cursor, since, limit = 50 } = options;
  const conditions = [eq(media.eventId, eventId)];
  if (since) conditions.push(gt(media.createdAt, new Date(since)));
  else if (cursor) conditions.push(lt(media.createdAt, new Date(cursor)));

  const visibilityFilter = isOwner
    ? undefined // owner sees every status (for moderation/preview)
    : guestId
      ? or(eq(media.status, "approved"), eq(media.guestId, guestId))
      : eq(media.status, "approved");

  const rows = await db
    .select()
    .from(media)
    .where(visibilityFilter ? and(...conditions, visibilityFilter) : and(...conditions))
    .orderBy(desc(media.createdAt))
    .limit(since ? SINCE_SAFETY_CAP : limit);

  return rows.map((row) => ({ ...row, mine: guestId != null && row.guestId === guestId }));
}
