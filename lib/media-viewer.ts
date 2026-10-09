import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { media } from "./schema";
import { findEventBySlug } from "./slugs";
import { resolveEventViewer } from "./event-viewer";
import { canViewMedia } from "./media-access";

/**
 * One item, and who is looking at it, for the routes that act on an item a
 * viewer can see: reporting it, hearting it, commenting on it.
 *
 * Null whenever the viewer may not see it, for whatever reason: no such event,
 * no access, not joined, deleted, hidden from them. The routes answer 404 for
 * all of those alike, so none of them can be used to learn that a hidden photo
 * exists.
 */
export async function resolveVisibleMedia(slug: string, mediaId: string) {
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return null;
  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed || (!viewer.guestId && !viewer.ownerSession)) return null;

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  const isManager = Boolean(viewer.ownerSession);
  if (!item || !canViewMedia(item, { isManager, guestId: viewer.guestId }, event)) return null;

  return {
    event,
    item,
    guestId: viewer.guestId,
    isManager,
    /** The team member's account, when the viewer is on the team. */
    managerUserId: viewer.ownerSession?.user?.id ?? null,
  };
}
