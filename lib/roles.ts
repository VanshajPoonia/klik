import { auth } from "./auth";
import type { Session } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { eventCoHosts, events } from "./schema";
import { can, type EventCapability, type EventRole } from "./permissions";
import { canUseCoHosts } from "./plans";

/** Superadmin-only routes/pages. Returns the session, or null if not a superadmin. */
export async function requireSuperadmin(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== "superadmin") return null;
  return session;
}

/** Event owner OR superadmin (admins can view/manage any provisioned event). */
export async function requireOwnerSession(eventOwnerId: string): Promise<Session | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.role === "superadmin") return session;
  if (session.user.id !== eventOwnerId) return null;
  return session;
}

export interface EventActor {
  session: Session;
  role: EventRole;
}

/**
 * Works out who the signed-in person is *on this event*, and with what role.
 *
 * This is the one query in the codebase allowed to read `event_co_hosts` for an
 * authorization decision. The revocation rule is the two predicates below, and
 * it lives inside the query that grants access on purpose: a removed co-host
 * keeps their row for 30 days so the removal is reversible, so any other query
 * that joins this table without `isNull(deletedAt)` hands the access back.
 *
 * Covered by `test/roles.dbtest.ts`, which cannot be written without a real
 * database because the predicates are the behaviour.
 */
export async function resolveEventActor(
  eventId: string,
  eventOwnerId: string,
): Promise<EventActor | null> {
  const session = await auth();
  if (!session?.user) return null;

  // A superadmin acts with owner powers, which is what makes admin support
  // possible at all. It is deliberately indistinguishable from the owner here.
  if (session.user.role === "superadmin" || session.user.id === eventOwnerId) {
    return { session, role: "owner" };
  }

  const [membership] = await db
    .select({ role: eventCoHosts.role, eventPlan: events.planKey })
    .from(eventCoHosts)
    .innerJoin(events, eq(events.id, eventCoHosts.eventId))
    .where(
      and(
        eq(eventCoHosts.eventId, eventId),
        eq(eventCoHosts.userId, session.user.id),
        // Removed co-hosts keep a row for 30 days so the removal is reversible.
        // This predicate is the entire revocation.
        isNull(eventCoHosts.deletedAt),
      ),
    )
    .limit(1);

  if (!membership) return null;

  // Gated on the capability rather than on `planKey === "premium"`, so a Venue
  // account does not silently lose every co-host the day it is introduced.
  // The event's plan since ACT-1: co-hosts are a feature of the event someone
  // paid for, not of the account. A draft has no plan and so no co-hosts yet.
  if (!membership.eventPlan || !canUseCoHosts(membership.eventPlan)) return null;

  return { session, role: membership.role };
}

/**
 * Event owner, assigned co-host, or superadmin.
 *
 * Kept as the coarse "may this person reach the management surfaces at all"
 * check that most routes still use. It answers *whether* somebody is on the
 * team, not *what they may do*, so any route performing a specific action
 * should use `requireEventCapability` instead.
 */
export async function requireEventManagerSession(
  eventId: string,
  eventOwnerId: string,
): Promise<Session | null> {
  const actor = await resolveEventActor(eventId, eventOwnerId);
  return actor?.session ?? null;
}

/**
 * The check a route performing a specific action should use. Returns the actor
 * when they hold the capability, and null otherwise, so the caller can answer
 * 401 or 403 without needing to know the role matrix.
 */
export async function requireEventCapability(
  eventId: string,
  eventOwnerId: string,
  capability: EventCapability,
): Promise<EventActor | null> {
  const actor = await resolveEventActor(eventId, eventOwnerId);
  if (!actor || !can(actor.role, capability)) return null;
  return actor;
}
