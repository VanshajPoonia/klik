import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { events, supportMessages, supportThreads, users } from "./schema";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import { reportError } from "./observability";

/**
 * MSG-1: talking to Klik. Each account has one conversation, and every
 * superadmin reads all of them on /admin/messages. A message can say which
 * event it is about.
 *
 * Polled, like the gallery: no websockets. The thread row holds when each side
 * last read and was last emailed, so "unread" is one comparison and a person
 * is emailed once per unread stretch, not once per message.
 */

export const MESSAGE_MAX = 4000;

export interface ThreadMessage {
  id: string;
  body: string;
  fromKlik: boolean;
  authorName: string | null;
  eventId: string | null;
  eventName: string | null;
  createdAt: string;
}

/**
 * Adds a message and moves the thread on. Two statements rather than one
 * transaction (neon-http has none): the thread first, because the message
 * points at it, so a failure between them leaves a thread with nothing new in
 * it, which reads as nothing having happened.
 */
export async function postMessage(input: {
  accountId: string;
  authorId: string | null;
  fromKlik: boolean;
  body: string;
  eventId?: string | null;
}): Promise<ThreadMessage> {
  const now = new Date();
  await db
    .insert(supportThreads)
    .values({
      accountId: input.accountId,
      lastMessageAt: now,
      ...(input.fromKlik ? { klikReadAt: now } : { accountReadAt: now }),
    })
    .onConflictDoUpdate({
      target: supportThreads.accountId,
      set: {
        lastMessageAt: now,
        // Writing is reading: whoever writes has seen everything before it.
        ...(input.fromKlik ? { klikReadAt: now } : { accountReadAt: now }),
      },
    });
  const [row] = await db
    .insert(supportMessages)
    .values({
      id: nanoid(),
      accountId: input.accountId,
      authorId: input.authorId,
      fromKlik: input.fromKlik,
      body: input.body,
      eventId: input.eventId ?? null,
      createdAt: now,
    })
    .returning();
  return {
    id: row.id,
    body: row.body,
    fromKlik: row.fromKlik,
    authorName: null,
    eventId: row.eventId,
    eventName: null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One account's conversation, oldest first, optionally only what is newer than `after`. */
export async function threadMessages(accountId: string, after?: Date | null): Promise<ThreadMessage[]> {
  const rows = await db
    .select({
      id: supportMessages.id,
      body: supportMessages.body,
      fromKlik: supportMessages.fromKlik,
      authorName: users.name,
      eventId: supportMessages.eventId,
      eventName: events.name,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.authorId))
    .leftJoin(events, eq(events.id, supportMessages.eventId))
    .where(and(eq(supportMessages.accountId, accountId), after ? gt(supportMessages.createdAt, after) : undefined))
    .orderBy(asc(supportMessages.createdAt))
    .limit(500);
  return rows.map((row) => ({
    ...row,
    // Klik's replies are signed "Klik", whoever wrote them; a superadmin's own
    // name is theirs to give.
    authorName: row.fromKlik ? "Klik" : row.authorName,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markRead(accountId: string, side: "account" | "klik"): Promise<void> {
  await db
    .update(supportThreads)
    .set(side === "klik" ? { klikReadAt: sql`now()` } : { accountReadAt: sql`now()` })
    .where(eq(supportThreads.accountId, accountId));
}

/** How many of Klik's replies this account has not seen. */
export async function unreadForAccount(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportMessages)
    .innerJoin(supportThreads, eq(supportThreads.accountId, supportMessages.accountId))
    .where(
      and(
        eq(supportMessages.accountId, accountId),
        eq(supportMessages.fromKlik, true),
        or(isNull(supportThreads.accountReadAt), gt(supportMessages.createdAt, supportThreads.accountReadAt)),
      ),
    );
  return row?.n ?? 0;
}

/** How many messages from accounts no superadmin has seen, across every thread. */
export async function unreadForKlik(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportMessages)
    .innerJoin(supportThreads, eq(supportThreads.accountId, supportMessages.accountId))
    .where(
      and(
        eq(supportMessages.fromKlik, false),
        or(isNull(supportThreads.klikReadAt), gt(supportMessages.createdAt, supportThreads.klikReadAt)),
      ),
    );
  return row?.n ?? 0;
}

export interface ThreadSummary {
  accountId: string;
  name: string | null;
  email: string | null;
  username: string | null;
  lastMessageAt: string;
  preview: string;
  lastFromKlik: boolean;
  unread: number;
}

/** Every conversation, unread first, then most recent. For /admin/messages. */
export async function listThreads(): Promise<ThreadSummary[]> {
  const unread = sql<number>`(
    SELECT count(*)::int FROM ${supportMessages} m
    WHERE m.account_id = ${supportThreads.accountId} AND m.from_klik = false
      AND (${supportThreads.klikReadAt} IS NULL OR m.created_at > ${supportThreads.klikReadAt})
  )`;
  const last = sql<string>`(
    SELECT m.body FROM ${supportMessages} m WHERE m.account_id = ${supportThreads.accountId}
    ORDER BY m.created_at DESC LIMIT 1
  )`;
  const lastFromKlik = sql<boolean>`(
    SELECT m.from_klik FROM ${supportMessages} m WHERE m.account_id = ${supportThreads.accountId}
    ORDER BY m.created_at DESC LIMIT 1
  )`;
  const rows = await db
    .select({
      accountId: supportThreads.accountId,
      name: users.name,
      email: users.email,
      username: users.username,
      lastMessageAt: supportThreads.lastMessageAt,
      preview: last,
      lastFromKlik,
      unread,
    })
    .from(supportThreads)
    .innerJoin(users, eq(users.id, supportThreads.accountId))
    .orderBy(desc(sql`${unread} > 0`), desc(supportThreads.lastMessageAt))
    .limit(200);
  return rows.map((row) => ({
    ...row,
    preview: (row.preview ?? "").slice(0, 140),
    lastFromKlik: Boolean(row.lastFromKlik),
    lastMessageAt: row.lastMessageAt.toISOString(),
  }));
}

/** Where Klik's own copy of a new message goes. */
function klikInbox(): string | null {
  return process.env.SUPPORT_INBOX_EMAIL || process.env.ALERT_EMAIL || null;
}

/**
 * Emails the other side, once per unread stretch: if they have read the thread
 * since they were last emailed, or were never emailed. Best effort and never
 * throws; the message is already saved and shows in the app either way.
 */
export async function notifyOtherSide(accountId: string, fromKlik: boolean, body: string): Promise<void> {
  try {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.accountId, accountId)).limit(1);
    if (!thread) return;
    const notifiedAt = fromKlik ? thread.accountNotifiedAt : thread.klikNotifiedAt;
    const readAt = fromKlik ? thread.accountReadAt : thread.klikReadAt;
    if (notifiedAt && (!readAt || readAt < notifiedAt)) return;

    const [account] = await db
      .select({ name: users.name, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, accountId))
      .limit(1);
    const to = fromKlik ? account?.email : klikInbox();
    if (!to) return;
    const appUrl = getAppUrl();
    const who = account?.name || (account?.username ? `@${account.username}` : account?.email) || "An organizer";
    const excerpt = body.length > 600 ? `${body.slice(0, 600)}…` : body;
    const message = fromKlik
      ? noticeEmail({
          subject: "Klik replied to your message",
          heading: "Klik replied",
          paragraphs: [excerpt],
          cta: { label: "Open your messages", url: `${appUrl}/dashboard/messages` },
          footer: "You get one email until you read the conversation, however many replies arrive before then.",
        })
      : noticeEmail({
          subject: `New message from ${who}`,
          heading: `${who} wrote to Klik`,
          paragraphs: [excerpt],
          cta: { label: "Reply on /admin", url: `${appUrl}/admin/messages?account=${encodeURIComponent(accountId)}` },
          footer: "One email per conversation until someone reads it on /admin.",
        });
    const result = await sendEmail({ ...message, to });
    if (result.sent) {
      await db
        .update(supportThreads)
        .set(fromKlik ? { accountNotifiedAt: sql`now()` } : { klikNotifiedAt: sql`now()` })
        .where(eq(supportThreads.accountId, accountId));
    }
  } catch (error) {
    reportError("messages.notify_failed", error, { accountId });
  }
}
