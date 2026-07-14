import { and, desc, eq, lt, or } from "drizzle-orm";
import { db } from "./db";
import { media } from "./schema";

export interface FetchGalleryOptions {
  isOwner: boolean;
  guestId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Single source of truth for "which media rows can this viewer see," shared
 * by the guest gallery API route and the guest page's initial server render. */
export async function fetchGalleryMedia(eventId: string, options: FetchGalleryOptions) {
  const { isOwner, guestId, cursor, limit = 50 } = options;
  const conditions = [eq(media.eventId, eventId)];
  if (cursor) conditions.push(lt(media.createdAt, new Date(cursor)));

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
    .limit(limit);

  return rows.map((row) => ({ ...row, mine: guestId != null && row.guestId === guestId }));
}
