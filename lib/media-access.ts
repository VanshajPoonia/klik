import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { media, type Media } from "./schema";

/**
 * Who may see a given photo. One rule, two expressions.
 *
 * Visibility has to be enforced in two places that cannot share code: the
 * gallery query, which needs SQL because filtering in JavaScript would mean
 * fetching private rows and trusting the client not to look, and the content
 * delivery route, which has a single row in hand and needs a boolean.
 *
 * Two expressions of one rule is exactly how a disclosure bug happens: someone
 * adds a visibility, updates the grid, and the direct media URL keeps serving
 * it. So both live here, side by side, and `test/media-access.dbtest.ts`
 * asserts they agree for **every** combination of visibility, status and
 * ownership against a real database rather than trusting that they look
 * similar.
 *
 * Note that visibility is **orthogonal to status**. `status` answers whether a
 * moderator approved the photo; `visibility` answers who it is for. A photo can
 * be approved and private. Both conditions must pass.
 */

export interface MediaViewer {
  /**
   * Owner, superadmin, or a co-host holding `media.viewPrivate`. Sees
   * everything, including private and link-only media, because moderation is
   * impossible otherwise.
   */
  isManager: boolean;
  /** The guest session, when there is one. Null for a signed-out visitor. */
  guestId: string | null;
}

/** The only event fields this decision depends on. */
export interface MediaAccessEvent {
  uploaderSeesOwnPrivate: boolean;
  /** CAM-4. While the roll has not developed, no guest sees any photo. */
  disposableMode: boolean;
  developsAt: Date | null;
}

/**
 * CAM-4: a disposable roll stays dark to every guest, the photographer
 * included, until it develops. Read at query time against the clock, so the
 * reveal happens on the second without anything having to run. A disposable
 * event with no develop time is waiting for the host to press "Develop".
 */
export function rollUndeveloped(event: MediaAccessEvent, now = new Date()): boolean {
  return event.disposableMode && (!event.developsAt || event.developsAt.getTime() > now.getTime());
}

/**
 * Single-row check, for the content route and anything holding one photo.
 *
 * Deliberately takes the whole row rather than a visibility string, so a caller
 * cannot accidentally check visibility while forgetting status.
 */
export function canViewMedia(
  item: Pick<Media, "visibility" | "status" | "guestId">,
  viewer: MediaViewer,
  event: MediaAccessEvent,
): boolean {
  if (viewer.isManager) return true;
  // Hosts see the roll as it fills, because they are moderating it.
  if (rollUndeveloped(event)) return false;

  const isUploader = viewer.guestId != null && item.guestId === viewer.guestId;

  switch (item.visibility) {
    case "gallery":
      // The pre-existing moderation rule, unchanged: a guest sees approved
      // media, plus their own upload while it waits for approval, so the queue
      // does not look like the upload silently failed.
      return item.status === "approved" || (item.status === "pending" && isUploader);

    case "private":
      // Managers already returned true above, so reaching here means a guest.
      // They see it only if it is theirs and the host left the setting on.
      return event.uploaderSeesOwnPrivate && isUploader;

    case "link":
      // Never in the gallery, for anyone but a manager. A link-only photo is
      // reachable solely through an active share token, and that path checks
      // the token rather than calling this. The uploader is not an exception:
      // marking something link-only is how a host takes it out of the room.
      return false;

    default:
      // An unknown visibility is a schema change this file has not caught up
      // with. Refuse rather than guess, because the two guesses available are
      // "show it" and "hide it", and only one of them is recoverable.
      return false;
  }
}

/**
 * The same rule as SQL, for the gallery query.
 *
 * Returns undefined for a manager, meaning no filter at all, which is how the
 * caller composes it without a special case.
 */
export function mediaVisibilityFilter(
  viewer: MediaViewer,
  event: MediaAccessEvent,
): SQL | undefined {
  if (viewer.isManager) return undefined;
  if (rollUndeveloped(event)) return sql`false`;

  const { guestId } = viewer;

  // Public gallery media, approved.
  const galleryApproved = and(eq(media.visibility, "gallery"), eq(media.status, "approved"))!;

  if (!guestId) {
    // A visitor with no guest session owns nothing, so every ownership-based
    // branch below collapses and this is the whole rule.
    return galleryApproved;
  }

  const ownPending = and(
    eq(media.visibility, "gallery"),
    eq(media.status, "pending"),
    eq(media.guestId, guestId),
  )!;

  const branches: SQL[] = [galleryApproved, ownPending];

  if (event.uploaderSeesOwnPrivate) {
    // Their own private photo. Status is deliberately not checked here: it is
    // their photo either way, and a pending private photo disappearing on them
    // would be the same confusing vanishing act the setting exists to avoid.
    branches.push(and(eq(media.visibility, "private"), eq(media.guestId, guestId))!);
  }

  return or(...branches)!;
}

/** Visibilities an organizer may set from the UI, with the copy for each. */
export const VISIBILITY_OPTIONS = [
  {
    value: "gallery",
    label: "In the gallery",
    description: "Everyone who can open this gallery sees it.",
  },
  {
    value: "private",
    label: "Hidden",
    description: "Only you and your co-hosts. The guest who uploaded it keeps seeing it.",
  },
  {
    value: "link",
    label: "Link only",
    description: "Out of the gallery. Reachable only by a share link you create.",
  },
] as const;
