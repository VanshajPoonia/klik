import { cookies } from "next/headers";
import { canViewGallery } from "./access";
import {
  eventUnlockCookieName,
  guestCookieName,
  verifyEventUnlock,
  verifyGuestSession,
} from "./guest";
import { requireEventManagerSession } from "./roles";
import { activeKiosk } from "./kiosks";
import type { Event } from "./schema";

export async function resolveEventViewer(event: Event) {
  const ownerSession = await requireEventManagerSession(event.id, event.ownerId);
  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie
    ? await verifyEventUnlock(unlockCookie, event.id, event.accessVersion)
    : false;
  const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
  const guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
  let guestId = guestSession?.eventId === event.id ? guestSession.guestId : null;
  // VEN-2: a kiosk's cookie is only as good as its row. Switched off, it is no
  // guest at all, so the tablet is shut out at this request.
  let kioskId: string | null = null;
  let kioskAlbumId: string | null = null;
  if (guestId && guestSession?.kioskId) {
    const kiosk = await activeKiosk({ kioskId: guestSession.kioskId, guestId, eventId: event.id });
    if (kiosk) {
      kioskId = kiosk.id;
      kioskAlbumId = kiosk.albumId;
    } else {
      guestId = null;
    }
  }
  // The host paired the kiosk, which stands in for the password. A private,
  // closed or ended gallery still refuses it, as it refuses every guest.
  const access = canViewGallery(event, {
    isOwner: Boolean(ownerSession),
    hasUnlockCookie: hasUnlockCookie || Boolean(kioskId),
  });

  return {
    access,
    guestId,
    /** VEN-2: set when this guest is a kiosk, which may upload and nothing else. */
    kioskId,
    /** The folder the host chose for this kiosk's photos. */
    kioskAlbumId,
    ownerSession,
  };
}
