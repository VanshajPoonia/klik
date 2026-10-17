import { and, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { eventCoHosts, events, users } from "./schema";
import { eventLicenseState, type LicenseState } from "./license";
import { getPlan } from "./plans";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import { recordAccountEvent } from "./timeline";
import { reportError } from "./observability";

/**
 * ADM-7: events as a superadmin sees them. Every event on the platform in one
 * list, and moving one to another account.
 */

export interface AdminEventRow {
  id: string;
  name: string;
  slug: string;
  eventDate: string | null;
  createdAt: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  license: LicenseState;
  planName: string | null;
  visibility: string;
  mediaCount: number;
  deleted: boolean;
  suspended: boolean;
}

export type AdminEventFilter = "all" | "live" | "draft" | "lapsed" | "deleted";

/** Up to 300 events, newest first, narrowed by a search and a state. */
export async function listAllEvents(query: string, filter: AdminEventFilter): Promise<AdminEventRow[]> {
  const needle = query.trim().replace(/^https?:\/\/[^/]+\/e\//, "").replace(/[%_\\]/g, "").slice(0, 100);
  const like = `%${needle}%`;
  const rows = await db
    .select({ event: events, ownerName: users.name, ownerEmail: users.email, ownerUsername: users.username })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(
      and(
        filter === "deleted" ? isNotNull(events.deletedAt) : filter === "all" ? undefined : isNull(events.deletedAt),
        filter === "live" ? isNotNull(events.entitlementId) : undefined,
        filter === "draft" ? and(isNull(events.entitlementId), isNull(events.licensedAt)) : undefined,
        filter === "lapsed" ? and(isNull(events.entitlementId), isNotNull(events.licensedAt)) : undefined,
        needle.length >= 2
          ? or(
              ilike(events.name, like),
              ilike(events.slug, like),
              ilike(events.clientName, like),
              ilike(users.name, like),
              ilike(users.email, like),
              ilike(users.username, like),
            )
          : undefined,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(300);
  return rows.map(({ event, ownerName, ownerEmail, ownerUsername }) => ({
    id: event.id,
    name: event.name,
    slug: event.slug,
    eventDate: event.eventDate ? event.eventDate.toISOString().slice(0, 10) : null,
    createdAt: event.createdAt.toISOString().slice(0, 10),
    ownerId: event.ownerId,
    ownerName: ownerName || (ownerUsername ? `@${ownerUsername}` : null),
    ownerEmail,
    license: eventLicenseState(event),
    planName: event.planKey ? getPlan(event.planKey).name : null,
    visibility: event.visibility,
    mediaCount: event.mediaCount,
    deleted: Boolean(event.deletedAt),
    suspended: Boolean(event.suspendedAt),
  }));
}

/** An account from what a person would type: an email, a handle, or an id. */
export async function findAccount(identifier: string) {
  const value = identifier.trim().replace(/^@/, "").toLowerCase();
  if (!value) return null;
  const [account] = await db
    .select({ id: users.id, name: users.name, email: users.email, username: users.username, role: users.role })
    .from(users)
    .where(or(sql`lower(${users.email}) = ${value}`, sql`lower(${users.username}) = ${value}`, eq(users.id, identifier.trim())))
    .limit(1);
  return account ?? null;
}

/**
 * Moves an event to another account, the way ORG-4's handover does: the new
 * owner runs it, the client link and venue feature are cleared because they
 * belonged to the old account, and the licence goes with the event, so a live
 * gallery stays live. The previous owner stays on the team as a manager unless
 * asked not to, or unless they are Klik, which can open any event anyway.
 *
 * Guarded on the owner read a moment before, so two moves crossing cannot
 * both land. No transaction (neon-http): the owner changes first, and a
 * failure after it leaves the event moved with the old team, which is safe.
 */
export async function moveEvent(input: {
  eventId: string;
  toUserId: string;
  keepPreviousOwner: boolean;
}): Promise<{ ok: true; previousOwnerId: string; eventName: string } | { ok: false; reason: "not_found" | "same_owner" | "conflict" }> {
  const [before] = await db
    .select({ ownerId: events.ownerId, name: events.name, ownerRole: users.role })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.ownerId === input.toUserId) return { ok: false, reason: "same_owner" };

  const [moved] = await db
    .update(events)
    .set({
      ownerId: input.toUserId,
      transferToUserId: null,
      transferOfferedAt: null,
      clientId: null,
      venueFeatured: false,
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, input.eventId), eq(events.ownerId, before.ownerId), isNull(events.deletedAt)))
    .returning({ id: events.id });
  if (!moved) return { ok: false, reason: "conflict" };

  // The new owner is no longer a co-host of their own event.
  await db.delete(eventCoHosts).where(and(eq(eventCoHosts.eventId, input.eventId), eq(eventCoHosts.userId, input.toUserId)));
  if (input.keepPreviousOwner && before.ownerRole !== "superadmin") {
    await db
      .insert(eventCoHosts)
      .values({ eventId: input.eventId, userId: before.ownerId, role: "manager" })
      .onConflictDoUpdate({
        target: [eventCoHosts.eventId, eventCoHosts.userId],
        set: { deletedAt: null, role: "manager", createdAt: new Date() },
      });
  }
  return { ok: true, previousOwnerId: before.ownerId, eventName: before.name };
}

/** Both histories, and an email to the new owner. Best effort; the move has happened. */
export async function recordMove(input: {
  eventId: string;
  eventName: string;
  fromUserId: string;
  toUserId: string;
  by: { id: string; label: string | null } | null;
}): Promise<void> {
  try {
    const [to] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.toUserId)).limit(1);
    const [from] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.fromUserId)).limit(1);
    await recordAccountEvent({
      userId: input.toUserId,
      kind: "event_moved",
      detail: `"${input.eventName}" was moved to this account from ${from?.name || from?.email || "another account"}.`,
      actor: input.by,
    });
    await recordAccountEvent({
      userId: input.fromUserId,
      kind: "event_moved",
      detail: `"${input.eventName}" was moved to ${to?.name || to?.email || "another account"}.`,
      actor: input.by,
    });
    if (to?.email) {
      await sendEmail({
        ...noticeEmail({
          subject: `${input.eventName} is now on your Klik account`,
          heading: `${input.eventName} is yours to run`,
          paragraphs: [
            "Klik has put this event on your account. Its gallery, QR code and photos are just as they were, and you can manage everything from your dashboard.",
          ],
          cta: { label: "Open the event", url: `${getAppUrl()}/dashboard/events/${input.eventId}` },
          footer: "Sent because Klik moved an event to your account.",
        }),
        to: to.email,
      });
    }
  } catch (error) {
    reportError("admin_events.record_move_failed", error, { eventId: input.eventId });
  }
}
