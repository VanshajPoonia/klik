import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { albums, events, mediaShares, shareSaves } from "./schema";
import { reportError } from "./observability";

/**
 * ACC-7: what was shared with an account. A signed-in person who opens a share
 * link (and gets through its gate) has it kept here, so /me can list it later
 * from any phone. Nothing is copied: the token is the link they were sent.
 */

/** Never throws: remembering a link is never worth failing the page over. */
export async function rememberShare(userId: string, shareId: string): Promise<void> {
  try {
    await db
      .insert(shareSaves)
      .values({ userId, shareId })
      .onConflictDoUpdate({ target: [shareSaves.userId, shareSaves.shareId], set: { lastOpenedAt: sql`now()` } });
  } catch (error) {
    reportError("share_saves.remember_failed", error, { userId });
  }
}

export interface SharedWithYou {
  token: string;
  eventName: string;
  /** "A photo", "A folder: Ceremony", "12 photos". */
  what: string;
  lastOpenedAt: Date;
}

/**
 * The links an account has opened that still open: not revoked, not expired,
 * not from a deleted or paused event. The full gate still runs when one is
 * tapped; this only keeps dead links off the list.
 */
export async function sharedWith(userId: string): Promise<SharedWithYou[]> {
  const rows = await db
    .select({
      token: mediaShares.token,
      scope: mediaShares.scope,
      eventName: events.name,
      folderName: albums.name,
      lastOpenedAt: shareSaves.lastOpenedAt,
      selectionCount: sql<number>`(SELECT count(*)::int FROM media_share_items WHERE share_id = ${mediaShares.id})`,
    })
    .from(shareSaves)
    .innerJoin(mediaShares, eq(mediaShares.id, shareSaves.shareId))
    .innerJoin(events, eq(events.id, mediaShares.eventId))
    .leftJoin(albums, eq(albums.id, mediaShares.albumId))
    .where(
      and(
        eq(shareSaves.userId, userId),
        isNull(mediaShares.revokedAt),
        or(isNull(mediaShares.expiresAt), gt(mediaShares.expiresAt, sql`now()`)),
        isNull(events.deletedAt),
        isNull(events.suspendedAt),
      ),
    )
    .orderBy(desc(shareSaves.lastOpenedAt))
    .limit(50);
  return rows.map((row) => ({
    token: row.token,
    eventName: row.eventName,
    what:
      row.scope === "album"
        ? `A folder${row.folderName ? `: ${row.folderName}` : ""}`
        : row.scope === "selection"
          ? `${row.selectionCount} ${row.selectionCount === 1 ? "photo" : "photos"}`
          : "A photo",
    lastOpenedAt: row.lastOpenedAt,
  }));
}
