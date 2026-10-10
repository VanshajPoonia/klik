import { getPlanDeadline } from "./plans";
import { eventLicenseState, eventPlan, windowStart } from "./license";
import type { Event } from "./schema";

export type GalleryAccess =
  | { allowed: true }
  | { allowed: false; reason: "private" | "password_required" | "expired" | "not_open" | "suspended" };

/** The event fields every access decision reads. */
export type AccessEvent = Pick<
  Event,
  "visibility" | "expiresAt" | "createdAt" | "licensedAt" | "entitlementId" | "planKey" | "suspendedAt"
>;

/**
 * Whether the gallery's viewing window has closed: the organizer's own expiry
 * date, or the plan's gallery window counted from when the event went live,
 * whichever comes first.
 *
 * Counted from going live rather than from creation since ACT-1, because a
 * draft can sit for months before the event it is for. A draft has no plan
 * window at all, since it has not started.
 */
export function isExpired(
  event: Pick<Event, "expiresAt" | "createdAt" | "licensedAt" | "planKey">,
): boolean {
  const configuredExpiry = event.expiresAt?.getTime();
  const planExpiry = event.licensedAt
    ? getPlanDeadline(windowStart(event), eventPlan(event).galleryAccessDays).getTime()
    : undefined;
  const effectiveExpiry =
    configuredExpiry && planExpiry
      ? Math.min(configuredExpiry, planExpiry)
      : (configuredExpiry ?? planExpiry);

  return Boolean(effectiveExpiry && effectiveExpiry < Date.now());
}

/** Single source of truth for who can view a gallery. Used by both pages and API routes. */
export function canViewGallery(
  event: AccessEvent,
  { isOwner, hasUnlockCookie }: { isOwner: boolean; hasUnlockCookie: boolean },
): GalleryAccess {
  if (isOwner) return { allowed: true };
  // A draft is not open to anyone but its team. A lapsed event stays viewable:
  // a revoked or expired plan stops new uploads, never guests seeing their own
  // memories (ROADMAP.md C-6).
  if (eventLicenseState(event) === "draft") return { allowed: false, reason: "not_open" };
  // ADM-5: paused by Klik. Before everything a guest could do something about.
  if (event.suspendedAt) return { allowed: false, reason: "suspended" };
  if (isExpired(event)) return { allowed: false, reason: "expired" };
  if (event.visibility === "private") return { allowed: false, reason: "private" };
  if (event.visibility === "password" && !hasUnlockCookie) {
    return { allowed: false, reason: "password_required" };
  }
  return { allowed: true };
}

/** Whether anyone may add media right now. Only a live event takes uploads. */
export function canUpload(
  event: Pick<
    Event,
    "isActive" | "uploadsEnabled" | "expiresAt" | "createdAt" | "licensedAt" | "entitlementId" | "planKey" | "suspendedAt"
  >,
): boolean {
  if (eventLicenseState(event) !== "live") return false;
  // ADM-5: a paused gallery takes nothing new, from the team either.
  if (event.suspendedAt) return false;
  if (!event.isActive || !event.uploadsEnabled || isExpired(event)) return false;
  return (
    getPlanDeadline(windowStart(event), eventPlan(event).uploadWindowDays).getTime() >= Date.now()
  );
}

export function isEventActive(
  event: Pick<Event, "isActive" | "expiresAt">,
  reference = new Date(),
): boolean {
  return event.isActive && (!event.expiresAt || event.expiresAt >= reference);
}
