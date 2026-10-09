import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { media, type Event, type Media } from "./schema";

/**
 * CAM-2: which photo an edited copy may be made from, by whom.
 *
 * The team may edit any photo in the event; a guest, only their own. A kiosk
 * edits nothing, and a guest on a disposable camera does not either, because
 * looking back at a shot is exactly what a disposable takes away. Videos are
 * not edited. The copy is a new photo; the original is never written to.
 */

export type EditRefusal = "kiosk" | "disposable" | "not_found";

export const EDIT_REFUSAL_MESSAGES: Record<EditRefusal, string> = {
  kiosk: "A kiosk cannot edit photos.",
  disposable: "Photos on a disposable camera cannot be edited.",
  not_found: "That photo cannot be edited.",
};

export async function editableOriginal(
  event: Pick<Event, "id" | "disposableMode">,
  originalId: string,
  viewer: { isManager: boolean; guestId: string | null; kioskId: string | null },
): Promise<{ original: Media } | { refused: EditRefusal }> {
  if (viewer.kioskId) return { refused: "kiosk" };
  if (!viewer.isManager && event.disposableMode) return { refused: "disposable" };
  const [original] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, originalId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!original || original.kind !== "photo") return { refused: "not_found" };
  if (!viewer.isManager && (!viewer.guestId || original.guestId !== viewer.guestId)) return { refused: "not_found" };
  return { original };
}
