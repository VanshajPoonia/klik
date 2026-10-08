import { cookies } from "next/headers";
import { canViewGallery } from "./access";
import {
  eventUnlockCookieName,
  guestCookieName,
  verifyEventUnlock,
  verifyGuestSession,
} from "./guest";
import { requireEventManagerSession } from "./roles";
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
  const guestId = guestSession?.eventId === event.id ? guestSession.guestId : null;
  const access = canViewGallery(event, {
    isOwner: Boolean(ownerSession),
    hasUnlockCookie,
  });

  return {
    access,
    guestId,
    ownerSession,
  };
}
