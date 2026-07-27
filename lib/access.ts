import { getPlanDeadline } from "./plans";
import type { Event } from "./schema";

export type GalleryAccess =
  | { allowed: true }
  | { allowed: false; reason: "private" | "password_required" | "expired" };

type EventVisibilityFields = Pick<Event, "visibility" | "expiresAt" | "createdAt">;

export function isExpired(
  event: Pick<Event, "expiresAt" | "createdAt">,
  galleryAccessDays?: number,
): boolean {
  const configuredExpiry = event.expiresAt?.getTime();
  const planExpiry = galleryAccessDays
    ? getPlanDeadline(event.createdAt, galleryAccessDays).getTime()
    : undefined;
  const effectiveExpiry =
    configuredExpiry && planExpiry
      ? Math.min(configuredExpiry, planExpiry)
      : (configuredExpiry ?? planExpiry);

  return Boolean(effectiveExpiry && effectiveExpiry < Date.now());
}

/** Single source of truth for who can view a gallery. Used by both pages and API routes. */
export function canViewGallery(
  event: EventVisibilityFields,
  {
    isOwner,
    hasUnlockCookie,
    galleryAccessDays,
  }: { isOwner: boolean; hasUnlockCookie: boolean; galleryAccessDays?: number },
): GalleryAccess {
  if (isOwner) return { allowed: true };
  if (isExpired(event, galleryAccessDays)) return { allowed: false, reason: "expired" };
  if (event.visibility === "private") return { allowed: false, reason: "private" };
  if (event.visibility === "password" && !hasUnlockCookie) {
    return { allowed: false, reason: "password_required" };
  }
  return { allowed: true };
}

export function canUpload(
  event: Pick<Event, "isActive" | "uploadsEnabled" | "expiresAt" | "createdAt">,
  uploadWindowDays?: number,
): boolean {
  if (!event.isActive || !event.uploadsEnabled || isExpired(event)) return false;
  if (!uploadWindowDays) return true;
  return getPlanDeadline(event.createdAt, uploadWindowDays).getTime() >= Date.now();
}

export function isEventActive(
  event: Pick<Event, "isActive" | "expiresAt">,
  reference = new Date(),
): boolean {
  return event.isActive && (!event.expiresAt || event.expiresAt >= reference);
}
