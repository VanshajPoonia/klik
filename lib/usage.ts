import { getPlanDeadline, type PlanDefinition } from "./plans";

/**
 * F-4 and PAY-7: how full an event is, worked out from the counters the
 * triggers keep on the event row. Pure, so the meter, the upload check and the
 * warning emails all agree, and the thresholds are tested in one place.
 */

/** Where the meter changes tone and an email goes, once each. */
export const WARN_PERCENTS = [75, 90, 100] as const;

export interface EventUsage {
  bytes: number;
  storageLimit: number;
  storagePercent: number;
  count: number;
  photoHeadline: number;
  headlinePercent: number;
  /** The highest of WARN_PERCENTS reached, or 0. */
  level: 0 | 75 | 90 | 100;
  full: boolean;
  /** Null when the event is not live, so no window is running. */
  uploadWindowEndsAt: Date | null;
  uploadDaysLeft: number | null;
}

export function eventUsage(
  event: { mediaBytes: number; mediaCount: number; licensedAt: Date | null; createdAt: Date },
  plan: Pick<PlanDefinition, "maxStorageBytesPerEvent" | "photoHeadline" | "uploadWindowDays">,
  now = new Date(),
): EventUsage {
  const storagePercent = Math.min(100, Math.floor((event.mediaBytes / plan.maxStorageBytesPerEvent) * 100));
  const level = ([...WARN_PERCENTS].reverse().find((threshold) => storagePercent >= threshold) ?? 0) as EventUsage["level"];
  const uploadWindowEndsAt = event.licensedAt ? getPlanDeadline(event.licensedAt, plan.uploadWindowDays) : null;
  return {
    bytes: event.mediaBytes,
    storageLimit: plan.maxStorageBytesPerEvent,
    storagePercent,
    count: event.mediaCount,
    photoHeadline: plan.photoHeadline,
    headlinePercent: Math.floor((event.mediaCount / plan.photoHeadline) * 100),
    level,
    full: event.mediaBytes >= plan.maxStorageBytesPerEvent,
    uploadWindowEndsAt,
    uploadDaysLeft: uploadWindowEndsAt
      ? Math.max(0, Math.ceil((uploadWindowEndsAt.getTime() - now.getTime()) / 86_400_000))
      : null,
  };
}

/** Whether `incoming` more bytes would take the event past its storage. */
export function wouldExceedStorage(
  event: { mediaBytes: number },
  plan: Pick<PlanDefinition, "maxStorageBytesPerEvent">,
  incoming: number,
): boolean {
  return event.mediaBytes + incoming > plan.maxStorageBytesPerEvent;
}

/** What a guest is told at the limit. Never the plan's name (ROADMAP C-1). */
export const GALLERY_FULL_MESSAGE = "This gallery is full. Ask the host to make room.";
