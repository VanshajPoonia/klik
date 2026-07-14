import type { Event } from "./schema";

export type GalleryAccess =
  | { allowed: true }
  | { allowed: false; reason: "private" | "password_required" | "expired" };

type EventVisibilityFields = Pick<Event, "visibility" | "expiresAt">;

export function isExpired(event: Pick<Event, "expiresAt">): boolean {
  return Boolean(event.expiresAt && event.expiresAt.getTime() < Date.now());
}

/** Single source of truth for who can view a gallery. Used by both pages and API routes. */
export function canViewGallery(
  event: EventVisibilityFields,
  { isOwner, hasUnlockCookie }: { isOwner: boolean; hasUnlockCookie: boolean },
): GalleryAccess {
  if (isOwner) return { allowed: true };
  if (isExpired(event)) return { allowed: false, reason: "expired" };
  if (event.visibility === "private") return { allowed: false, reason: "private" };
  if (event.visibility === "password" && !hasUnlockCookie) {
    return { allowed: false, reason: "password_required" };
  }
  return { allowed: true };
}

export function canUpload(event: Pick<Event, "uploadsEnabled" | "expiresAt">): boolean {
  return event.uploadsEnabled && !isExpired(event);
}
