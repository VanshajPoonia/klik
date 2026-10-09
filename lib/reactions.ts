import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { media, mediaReactions } from "./schema";

/**
 * MED-9: hearts.
 *
 * Open to anonymous guests, because the per-event guest cookie already says
 * who someone is well enough for a heart, and a heart is close to unabusable.
 * The host can heart too, from their own gallery, as their account. One heart
 * per person per item, toggled.
 *
 * Counts live on `media.reaction_count`, kept by triggers in drizzle/0030, so
 * nothing here counts rows to answer "how many".
 */

/** Who is hearting: the guest cookie's guest, or the host's account. */
export type Reactor = { guestId: string } | { userId: string };

export function reactorFor(viewer: { guestId: string | null; userId: string | null }): Reactor | null {
  // A guest's own identity at this event wins: a signed-in guest's guest row
  // is already linked to their account (ACC-3), and the host has no guest row.
  if (viewer.guestId) return { guestId: viewer.guestId };
  if (viewer.userId) return { userId: viewer.userId };
  return null;
}

function reactorKey(reactor: Reactor): string {
  return "guestId" in reactor ? `g:${reactor.guestId}` : `u:${reactor.userId}`;
}

/**
 * Hearts or un-hearts one item. Idempotent both ways, so a double tap or a
 * retried request lands on the state that was asked for. Returns the count
 * after the change, as the trigger left it.
 */
export async function setReaction(
  mediaId: string,
  reactor: Reactor,
  on: boolean,
): Promise<{ reacted: boolean; count: number }> {
  const key = reactorKey(reactor);
  if (on) {
    await db
      .insert(mediaReactions)
      .values({
        mediaId,
        reactor: key,
        guestId: "guestId" in reactor ? reactor.guestId : null,
        userId: "userId" in reactor ? reactor.userId : null,
        kind: "heart",
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(mediaReactions)
      .where(and(eq(mediaReactions.mediaId, mediaId), eq(mediaReactions.reactor, key)));
  }
  const [row] = await db
    .select({ count: media.reactionCount })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  return { reacted: on, count: row?.count ?? 0 };
}

/** Which of these items this person has hearted. One query for a whole page. */
export async function reactedIds(mediaIds: string[], reactor: Reactor | null): Promise<Set<string>> {
  if (!reactor || mediaIds.length === 0) return new Set();
  const rows = await db
    .select({ mediaId: mediaReactions.mediaId })
    .from(mediaReactions)
    .where(and(inArray(mediaReactions.mediaId, mediaIds), eq(mediaReactions.reactor, reactorKey(reactor))));
  return new Set(rows.map((row) => row.mediaId));
}

/**
 * Adds `reacted` to a gallery payload, for the person it is going to. Skips the
 * query when the event has hearts switched off, which is most events.
 */
export async function withViewerReactions<T extends { id: string }>(
  items: T[],
  event: { reactionsEnabled: boolean },
  reactor: Reactor | null,
): Promise<Array<T & { reacted: boolean }>> {
  const reacted = event.reactionsEnabled
    ? await reactedIds(items.map((item) => item.id), reactor)
    : new Set<string>();
  return items.map((item) => ({ ...item, reacted: reacted.has(item.id) }));
}
