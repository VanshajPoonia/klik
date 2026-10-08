import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { eventCoHosts, eventInvites, events, users, type EventInvite } from "./schema";
import type { AssignableRole } from "./permissions";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import { reportError } from "./observability";
import { isUniqueViolation } from "./db-errors";

/**
 * ORG-3 and ORG-4: inviting people onto an event's team, and handing the event
 * itself to one of them.
 *
 * Invitations go to an email address, not an account, so they work for people
 * who have never used Klik: the link survives signing up. Acceptance requires
 * being signed in **as that address**, so an invitation forwarded to somebody
 * else is useless to them. Only a hash of the token is stored.
 */

export const INVITE_DAYS = 14;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Open invitations count against the plan's co-host limit, like members do. */
export async function openInvites(eventId: string): Promise<EventInvite[]> {
  return db
    .select()
    .from(eventInvites)
    .where(
      and(
        eq(eventInvites.eventId, eventId),
        isNull(eventInvites.acceptedAt),
        isNull(eventInvites.revokedAt),
        gt(eventInvites.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(eventInvites.createdAt));
}

/**
 * Invites an address. Inviting it again replaces the open invitation with a
 * fresh one, which is how "send it again" works, so there is only ever one live
 * link per address per event.
 */
export async function createInvite({
  eventId,
  email,
  role,
  invitedByUserId,
}: {
  eventId: string;
  email: string;
  role: AssignableRole;
  invitedByUserId: string;
}): Promise<{ invite: EventInvite; token: string }> {
  const address = normalizeEmail(email);
  try {
    return await insertInvite({ eventId, address, role, invitedByUserId });
  } catch (error) {
    // Two sends to one address at once: both revoked the old link, and the
    // second insert met the first's open row. Once more replaces it.
    if (!isUniqueViolation(error)) throw error;
    return insertInvite({ eventId, address, role, invitedByUserId });
  }
}

async function insertInvite({
  eventId,
  address,
  role,
  invitedByUserId,
}: {
  eventId: string;
  address: string;
  role: AssignableRole;
  invitedByUserId: string;
}): Promise<{ invite: EventInvite; token: string }> {
  await db
    .update(eventInvites)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(eventInvites.eventId, eventId),
        eq(eventInvites.email, address),
        isNull(eventInvites.acceptedAt),
        isNull(eventInvites.revokedAt),
      ),
    );
  const token = randomBytes(24).toString("base64url");
  const [invite] = await db
    .insert(eventInvites)
    .values({
      id: `inv_${nanoid()}`,
      eventId,
      email: address,
      role,
      tokenHash: hashInviteToken(token),
      invitedByUserId,
      expiresAt: sql`now() + (${INVITE_DAYS}::int * interval '1 day')`,
    })
    .returning();
  return { invite, token };
}

export type InviteLookup =
  | { state: "valid"; invite: EventInvite; eventName: string; inviterName: string | null }
  | { state: "expired" | "revoked" | "accepted" | "missing" };

export async function lookupInvite(token: string): Promise<InviteLookup> {
  const [row] = await db
    .select({ invite: eventInvites, eventName: events.name, deletedAt: events.deletedAt, inviterName: users.name })
    .from(eventInvites)
    .innerJoin(events, eq(events.id, eventInvites.eventId))
    .leftJoin(users, eq(users.id, eventInvites.invitedByUserId))
    .where(eq(eventInvites.tokenHash, hashInviteToken(token)))
    .limit(1);
  if (!row || row.deletedAt) return { state: "missing" };
  if (row.invite.acceptedAt) return { state: "accepted" };
  if (row.invite.revokedAt) return { state: "revoked" };
  if (row.invite.expiresAt.getTime() <= Date.now()) return { state: "expired" };
  return { state: "valid", invite: row.invite, eventName: row.eventName, inviterName: row.inviterName };
}

/**
 * Accepts an invitation as `user`, who must be signed in with the invited
 * address. The acceptance is a conditional update, so a link pressed twice, or
 * twice at once, adds the member once.
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string | null },
): Promise<{ ok: true; eventId: string } | { ok: false; reason: string }> {
  const found = await lookupInvite(token);
  if (found.state !== "valid") {
    return { ok: false, reason: found.state === "accepted" ? "This invitation has already been used." : "This invitation is no longer valid." };
  }
  if (!user.email || normalizeEmail(user.email) !== found.invite.email) {
    return { ok: false, reason: `This invitation is for ${found.invite.email}. Sign in with that address to accept it.` };
  }
  const [claimed] = await db
    .update(eventInvites)
    .set({ acceptedAt: sql`now()`, acceptedByUserId: user.id })
    .where(and(eq(eventInvites.id, found.invite.id), isNull(eventInvites.acceptedAt), isNull(eventInvites.revokedAt)))
    .returning();
  if (!claimed) return { ok: false, reason: "This invitation has already been used." };

  const [event] = await db.select({ ownerId: events.ownerId }).from(events).where(eq(events.id, claimed.eventId)).limit(1);
  if (event?.ownerId !== user.id) {
    await db
      .insert(eventCoHosts)
      .values({ eventId: claimed.eventId, userId: user.id, role: claimed.role })
      .onConflictDoUpdate({
        target: [eventCoHosts.eventId, eventCoHosts.userId],
        set: { deletedAt: null, createdAt: new Date(), role: claimed.role },
      });
  }
  return { ok: true, eventId: claimed.eventId };
}

export async function revokeInvite(inviteId: string, eventId: string): Promise<boolean> {
  const rows = await db
    .update(eventInvites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(eventInvites.id, inviteId), eq(eventInvites.eventId, eventId), isNull(eventInvites.acceptedAt), isNull(eventInvites.revokedAt)))
    .returning({ id: eventInvites.id });
  return rows.length > 0;
}

// --- ORG-4: transfer ----------------------------------------------------------

/**
 * The owner offers the event to a manager on its team. A manager because they
 * already run it; anyone else would be handed an event they have never seen.
 */
export async function offerTransfer(eventId: string, toUserId: string): Promise<boolean> {
  const [member] = await db
    .select({ role: eventCoHosts.role })
    .from(eventCoHosts)
    .where(and(eq(eventCoHosts.eventId, eventId), eq(eventCoHosts.userId, toUserId), isNull(eventCoHosts.deletedAt)))
    .limit(1);
  if (member?.role !== "manager") return false;
  await db
    .update(events)
    .set({ transferToUserId: toUserId, transferOfferedAt: sql`now()` })
    .where(eq(events.id, eventId));
  return true;
}

/**
 * Withdraws an offer. With `onlyFor`, only an offer to that person, which is
 * what removing or demoting a member wants: it must not cancel an offer made to
 * somebody else.
 */
export async function cancelTransfer(eventId: string, onlyFor?: string): Promise<void> {
  await db
    .update(events)
    .set({ transferToUserId: null, transferOfferedAt: null })
    .where(and(eq(events.id, eventId), onlyFor ? eq(events.transferToUserId, onlyFor) : undefined));
}

/**
 * The recipient says yes. One conditional update moves the ownership, so it can
 * only happen once and only for the person it was offered to. Then the old
 * owner stays on the team as a manager, and the new owner's member row goes,
 * since an owner is not their own co-host.
 *
 * The licence does not move: the event stays live on what the old owner paid
 * for. The venue client link is cleared, because clients belong to an account
 * and the new owner cannot see the old owner's list; the client's name and
 * contact stay on the event as text.
 */
export async function acceptTransfer(
  eventId: string,
  userId: string,
): Promise<{ ok: true; previousOwnerId: string } | { ok: false }> {
  const [before] = await db.select({ ownerId: events.ownerId }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!before) return { ok: false };
  const [moved] = await db
    .update(events)
    .set({
      ownerId: userId,
      transferToUserId: null,
      transferOfferedAt: null,
      clientId: null,
      venueFeatured: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.transferToUserId, userId),
        eq(events.ownerId, before.ownerId),
        isNull(events.deletedAt),
        // Still a manager on the team. An offer outlives nothing: removing the
        // recipient, or demoting them, leaves an offer that cannot be taken.
        sql`EXISTS (
          SELECT 1 FROM ${eventCoHosts}
          WHERE ${eventCoHosts.eventId} = ${eventId}
            AND ${eventCoHosts.userId} = ${userId}
            AND ${eventCoHosts.role} = 'manager'
            AND ${eventCoHosts.deletedAt} IS NULL
        )`,
      ),
    )
    .returning({ id: events.id });
  if (!moved) return { ok: false };

  await db.delete(eventCoHosts).where(and(eq(eventCoHosts.eventId, eventId), eq(eventCoHosts.userId, userId)));
  await db
    .insert(eventCoHosts)
    .values({ eventId, userId: before.ownerId, role: "manager" })
    .onConflictDoUpdate({
      target: [eventCoHosts.eventId, eventCoHosts.userId],
      set: { deletedAt: null, role: "manager", createdAt: new Date() },
    });
  return { ok: true, previousOwnerId: before.ownerId };
}

// --- Emails --------------------------------------------------------------------

async function send(to: string | null, message: Parameters<typeof noticeEmail>[0]) {
  if (!to) return;
  try {
    await sendEmail({ ...noticeEmail(message), to });
  } catch (error) {
    reportError("team.email_failed", error);
  }
}

export async function emailInvite(email: string, token: string, eventName: string, inviterName: string | null) {
  const url = `${getAppUrl()}/invite/${token}`;
  await send(email, {
    subject: `Help run ${eventName} on Klik`,
    heading: `${inviterName ?? "Someone"} invited you to help run ${eventName}`,
    paragraphs: [
      "Klik is the shared photo gallery for the event. As part of the team you can see every photo and video guests share, and help look after the gallery.",
      `The link works for ${INVITE_DAYS} days. If you do not have a Klik account yet, you make one with this email address on the way in. It costs nothing.`,
    ],
    cta: { label: "Join the team", url },
    footer: "Sent because somebody invited this address to an event's team. If you were not expecting it, ignore it.",
  });
}

export async function emailAddedToTeam(email: string | null, eventId: string, eventName: string) {
  await send(email, {
    subject: `You are on the team for ${eventName}`,
    heading: `You are on the team for ${eventName}`,
    paragraphs: ["It is in your Klik dashboard now, alongside your own events."],
    cta: { label: "Open it", url: `${getAppUrl()}/dashboard/events/${eventId}` },
    footer: "Sent because the event's owner added your account to its team.",
  });
}

export async function emailTransferOffered(email: string | null, eventId: string, eventName: string) {
  await send(email, {
    subject: `${eventName} is being handed to you`,
    heading: `Take over ${eventName}?`,
    paragraphs: [
      "The owner has offered you the event. If you accept, it becomes yours to run and they stay on the team as a manager. Nothing changes until you say yes.",
    ],
    cta: { label: "Review the offer", url: `${getAppUrl()}/dashboard/events/${eventId}` },
    footer: "Sent because an event's owner offered it to you.",
  });
}
