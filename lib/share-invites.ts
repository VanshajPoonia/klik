import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { auth } from "./auth";
import { db } from "./db";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { reportError } from "./observability";
import { resolveEventActor } from "./roles";
import { shareInvites, mediaShares, users, type Event, type MediaShare } from "./schema";
import { shareUrl } from "./shares";

/**
 * MED-14: a share link for particular people. A host, or a guest for their
 * own photos, types the addresses; each gets an email with the link and a
 * code of its own; the link then opens only for the event's team and for the
 * accounts it was sent to, whoever else holds the URL.
 *
 * Who counts as "sent to", decided in `inviteAccess`:
 * - an account the invite is already bound to;
 * - the first account to open the link with the email's code while signed in
 *   with the invited address, which binds it (the code proves the inbox, the
 *   address proves it is the intended account, as for co-host invites);
 * - without the code, an account whose address was verified by a sign-in code,
 *   which is how an invite that could not be emailed still reaches its person.
 */

/** Addresses in one go, so one paste cannot become a mailing. */
export const MAX_INVITES_PER_REQUEST = 20;
/** Addresses on one link. A link for more people than this is a link for anyone. */
export const MAX_INVITES_PER_LINK = 50;

const emailSchema = z.string().email().max(254);

export function normalizeInviteEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashShareInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Typed or pasted: commas, semicolons, spaces or new lines between them, "Name <a@b.c>" too. */
export function parseInviteEmails(input: string | string[]): { valid: string[]; invalid: string[] } {
  const pieces = (Array.isArray(input) ? input.join("\n") : input)
    .split(/[\s,;]+/)
    .map((piece) => piece.replace(/^<|>$/g, "").replace(/^mailto:/i, ""))
    .map(normalizeInviteEmail);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const piece of pieces) {
    // Words without an @ are the names in "Ana Ruiz <ana@example.com>".
    if (!piece.includes("@")) continue;
    if (emailSchema.safeParse(piece).success) {
      if (!valid.includes(piece)) valid.push(piece);
    } else if (piece.includes("@") && !invalid.includes(piece)) {
      invalid.push(piece);
    }
  }
  return { valid, invalid };
}

export interface InviteSummary {
  id: string;
  email: string;
  /** Someone has opened the link as this invite. */
  opened: boolean;
  /** Its email went out. False when the day's mail ran out or mail is off. */
  emailed: boolean;
}

export async function listInvites(shareId: string): Promise<InviteSummary[]> {
  const rows = await db
    .select({ id: shareInvites.id, email: shareInvites.email, openedAt: shareInvites.openedAt, emailedAt: shareInvites.emailedAt })
    .from(shareInvites)
    .where(eq(shareInvites.shareId, shareId))
    .orderBy(asc(shareInvites.createdAt));
  return rows.map((row) => ({ id: row.id, email: row.email, opened: row.openedAt != null, emailed: row.emailedAt != null }));
}

export interface InviteResult {
  /** Newly invited, and emailed. */
  sent: string[];
  /** Newly invited, but the email did not go: the day's mail is used up, or mail is off. */
  unsent: string[];
  /** Already on this link. */
  already: string[];
  /** Not invited: the link already has MAX_INVITES_PER_LINK. */
  full: string[];
}

/**
 * Makes the link invite-only and invites these addresses. Turned invite-only
 * first, so a failure part way leaves a link that opens for fewer people,
 * never more. Each email is sent as bulk mail, so invitations stop before the
 * last of the day's mail, which is kept for sign-in codes.
 */
export async function inviteToShare(input: {
  share: MediaShare;
  event: Pick<Event, "id" | "name">;
  emails: string[];
  invitedBy: { userId: string } | { guestId: string };
  /** "Ana", "Dave and Diane": who the email says sent it. */
  inviterName: string;
  /** "a folder, Ceremony", "12 photos", "a photo". */
  what: string;
}): Promise<InviteResult> {
  const result: InviteResult = { sent: [], unsent: [], already: [], full: [] };
  if (!input.share.inviteOnly) {
    await db.update(mediaShares).set({ inviteOnly: true }).where(eq(mediaShares.id, input.share.id));
  }
  const existing = new Set(
    (await db.select({ email: shareInvites.email }).from(shareInvites).where(eq(shareInvites.shareId, input.share.id))).map(
      (row) => row.email,
    ),
  );
  let room = MAX_INVITES_PER_LINK - existing.size;
  for (const raw of input.emails) {
    const email = normalizeInviteEmail(raw);
    if (existing.has(email)) {
      result.already.push(email);
      continue;
    }
    if (room <= 0) {
      result.full.push(email);
      continue;
    }
    const token = randomBytes(24).toString("base64url");
    const [invite] = await db
      .insert(shareInvites)
      .values({
        id: `sinv_${nanoid()}`,
        shareId: input.share.id,
        email,
        tokenHash: hashShareInviteToken(token),
        invitedByUserId: "userId" in input.invitedBy ? input.invitedBy.userId : null,
        invitedByGuestId: "guestId" in input.invitedBy ? input.invitedBy.guestId : null,
      })
      .onConflictDoNothing()
      .returning({ id: shareInvites.id });
    if (!invite) {
      // Invited by somebody else in the same moment.
      result.already.push(email);
      continue;
    }
    existing.add(email);
    room -= 1;
    const sent = await sendInviteEmail({ ...input, email, token });
    if (sent) {
      await db.update(shareInvites).set({ emailedAt: new Date() }).where(eq(shareInvites.id, invite.id));
      result.sent.push(email);
    } else {
      result.unsent.push(email);
    }
  }
  return result;
}

async function sendInviteEmail(input: {
  share: MediaShare;
  event: Pick<Event, "name">;
  email: string;
  token: string;
  inviterName: string;
  what: string;
}): Promise<boolean> {
  const who = input.inviterName.trim().slice(0, 60) || "Someone";
  const url = `${shareUrl(input.share.token)}?invite=${encodeURIComponent(input.token)}`;
  const message = noticeEmail({
    subject: `${who} shared photos from ${input.event.name} with you`,
    heading: `${who} shared ${input.what} with you`,
    paragraphs: [
      `From ${input.event.name}, on Klik. Only the people ${who} invited can open it.`,
      `Open it signed in as ${input.email}. If you do not have a Klik account, you can make one with this address on the way: it takes an email code, no password.`,
    ],
    cta: { label: "Open the photos", url },
    footer: `You got this because ${who} typed your address into Klik. If you do not know them, ignore it: nothing happens unless you open the link.`,
  });
  try {
    const result = await sendEmail({ ...message, to: input.email }, { bulk: true });
    return result.sent;
  } catch (error) {
    reportError("share_invite.email_failed", error, { shareId: input.share.id });
    return false;
  }
}

/** Takes one address off the link. The row goes: nothing about them is kept. */
export async function removeInvite(shareId: string, inviteId: string): Promise<boolean> {
  const removed = await db
    .delete(shareInvites)
    .where(and(eq(shareInvites.id, inviteId), eq(shareInvites.shareId, shareId)))
    .returning({ id: shareInvites.id });
  return removed.length > 0;
}

/** Back to a link anyone holding it can open. The invites are kept, unused. */
export async function openToAnyone(shareId: string): Promise<void> {
  await db.update(mediaShares).set({ inviteOnly: false }).where(eq(mediaShares.id, shareId));
}

export type InviteAccess =
  | { allowed: true; as: "team" | "invited" }
  | { allowed: false; reason: "sign_in" | "not_invited"; email: string | null };

/**
 * Whether the person asking may open an invite-only link. `code` is the one
 * from their email's link, present on the first visit from it.
 */
export async function inviteAccess(
  share: Pick<MediaShare, "id">,
  event: Pick<Event, "id" | "ownerId">,
  code?: string | null,
): Promise<InviteAccess> {
  if (await resolveEventActor(event.id, event.ownerId)) return { allowed: true, as: "team" };
  const userId = (await auth())?.user?.id;
  if (!userId) return { allowed: false, reason: "sign_in", email: null };

  const [bound] = await db
    .select({ id: shareInvites.id })
    .from(shareInvites)
    .where(and(eq(shareInvites.shareId, share.id), eq(shareInvites.userId, userId)))
    .limit(1);
  if (bound) return { allowed: true, as: "invited" };

  const [account] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const email = account?.email ? normalizeInviteEmail(account.email) : null;
  if (!email) return { allowed: false, reason: "not_invited", email: null };

  const [invite] = await db
    .select({ id: shareInvites.id, tokenHash: shareInvites.tokenHash })
    .from(shareInvites)
    .where(and(eq(shareInvites.shareId, share.id), eq(shareInvites.email, email), isNull(shareInvites.userId)))
    .limit(1);
  const proven = invite && ((code && hashShareInviteToken(code) === invite.tokenHash) || account?.emailVerified);
  if (!invite || !proven) return { allowed: false, reason: "not_invited", email };

  await db
    .update(shareInvites)
    .set({ userId, openedAt: new Date() })
    .where(and(eq(shareInvites.id, invite.id), isNull(shareInvites.userId)));
  return { allowed: true, as: "invited" };
}

/** "a folder, Ceremony", "12 photos", "a video": what an invite email says was shared. */
export function describeShareTarget(row: {
  share: Pick<MediaShare, "scope">;
  albumName: string | null;
  itemCount: number | null;
  item: { kind: string } | null;
}): string {
  if (row.share.scope === "album") return row.albumName ? `a folder, ${row.albumName}` : "a folder of photos";
  if (row.share.scope === "selection") {
    const count = row.itemCount ?? 0;
    return count === 1 ? "a photo" : `${count} photos`;
  }
  return row.item?.kind === "video" ? "a video" : "a photo";
}

/** The request body for adding people, from a host or a guest. */
export const inviteRequestSchema = z.object({
  emails: z.union([z.string().max(10_000), z.array(z.string().max(320)).max(200)]),
});
