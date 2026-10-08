import { getPlan, type PlanDefinition, type PlanKey } from "./plans";
import type { Entitlement, Event } from "./schema";

/**
 * The pure half of ACT-1: what state an event is in and which plan governs it,
 * answered from the event's own row. Kept apart from lib/entitlements.ts, which
 * talks to the database, so that lib/access.ts and anything a browser bundle
 * reaches can use these without pulling in a database client.
 */

export type LicenseState = "draft" | "live" | "lapsed";

/** Pure: what state an event is in, from its own row. */
export function eventLicenseState(
  event: Pick<Event, "entitlementId" | "licensedAt">,
): LicenseState {
  if (event.entitlementId) return "live";
  return event.licensedAt ? "lapsed" : "draft";
}

/**
 * Pure: the plan that governs an event's windows and features.
 *
 * A draft has no plan of its own and is governed by the most restrictive one,
 * Klik Event, for feature gates. That is safe precisely because a draft cannot
 * be seen or uploaded to at all: the gates that matter for a draft are
 * `eventLicenseState`, not this.
 */
export function eventPlan(event: Pick<Event, "planKey">): PlanDefinition {
  return getPlan(event.planKey);
}

/** When an event's upload and access windows start: going live, not creation. */
export function windowStart(event: Pick<Event, "licensedAt" | "createdAt">): Date {
  return event.licensedAt ?? event.createdAt;
}

/** Passes for Event and Premium, an account grant for Venue. */
export function scopeForPlan(planKey: PlanKey): "event" | "account" {
  return planKey === "venue" ? "account" : "event";
}

/** Pure: whether a grant is in force at `now`. */
export function isGrantCurrent(
  grant: Pick<Entitlement, "status" | "startsAt" | "endsAt">,
  now = new Date(),
): boolean {
  return (
    grant.status === "active" &&
    grant.startsAt.getTime() <= now.getTime() &&
    (!grant.endsAt || grant.endsAt.getTime() > now.getTime())
  );
}

/** How the limit trigger's errors read to a person. */
export function describeLicenseRefusal(code: string, plan?: PlanDefinition): string {
  switch (code) {
    case "entitlement_active_limit":
      return `${plan?.name ?? "This plan"} covers ${plan?.maxActiveEvents ?? "a limited number of"} live events at once. Close one, or it stays a draft until a slot frees up.`;
    case "entitlement_monthly_limit":
      return `${plan?.name ?? "This plan"} covers ${plan?.maxEventsPerMonth ?? "a limited number of"} new events a month. It stays a draft until the allowance resets on the 1st.`;
    case "entitlement_already_applied":
      return "That pass has already been used for another event.";
    case "entitlement_inactive":
      return "That plan is no longer active.";
    default:
      return "This event could not be activated.";
  }
}

