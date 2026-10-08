import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { events, guests, media } from "./schema";
import { guestCookieName, verifyGuestSession } from "./guest";
import { eraseGuest, type ErasureResult } from "./erasure";

/**
 * ACC-1, ACC-3 and ACC-4: a guest who is also signed in.
 *
 * Nothing here is needed to join a gallery or to upload, and nothing here may
 * become needed. An account only adds memory: the galleries you joined, from
 * any phone, and one place to take back what you shared.
 */

const GUEST_COOKIE_PREFIX = "klik_g_";

/**
 * ACC-3: attaches the anonymous guest sessions this browser holds to `userId`.
 *
 * Each cookie is verified, and must be named for the event it is signed for,
 * so a cookie can only ever claim the guest it was issued to. A guest already
 * attached to an account stays where it is: on a shared phone, signing in as
 * somebody else must not move the first person's uploads to them.
 */
export async function claimGuestCookies(
  userId: string,
  cookieList: Array<{ name: string; value: string }>,
): Promise<number> {
  const guestIds: string[] = [];
  for (const cookie of cookieList) {
    if (!cookie.name.startsWith(GUEST_COOKIE_PREFIX)) continue;
    const session = await verifyGuestSession(cookie.value);
    if (session && cookie.name === guestCookieName(session.eventId)) guestIds.push(session.guestId);
  }
  if (guestIds.length === 0) return 0;
  const claimed = await db
    .update(guests)
    .set({ userId })
    .where(and(inArray(guests.id, guestIds), isNull(guests.userId)))
    .returning({ id: guests.id });
  return claimed.length;
}

/**
 * ACC-5: the guest row a signed-in person already has at this event, if any.
 * Joining again from a new phone resumes it, so their uploads stay theirs
 * rather than splitting across two anonymous guests.
 */
export async function existingGuestFor(userId: string, eventId: string) {
  const [row] = await db
    .select()
    .from(guests)
    .where(and(eq(guests.userId, userId), eq(guests.eventId, eventId)))
    .orderBy(desc(guests.createdAt))
    .limit(1);
  return row ?? null;
}

export interface JoinedGallery {
  eventId: string;
  name: string;
  slug: string;
  eventDate: string | null;
  joinedAt: string;
  uploads: number;
  ended: boolean;
}

/** ACC-4: every gallery this account has joined as a guest, newest first. */
export async function joinedGalleries(userId: string): Promise<JoinedGallery[]> {
  const rows = await db
    .select({
      eventId: events.id,
      name: events.name,
      slug: events.slug,
      eventDate: events.eventDate,
      isActive: events.isActive,
      expiresAt: events.expiresAt,
      joinedAt: sql<Date>`min(${guests.createdAt})`,
      uploads: sql<number>`count(${media.id}) FILTER (WHERE ${media.deletedAt} IS NULL)::int`,
    })
    .from(guests)
    .innerJoin(events, eq(events.id, guests.eventId))
    .leftJoin(media, eq(media.guestId, guests.id))
    .where(and(eq(guests.userId, userId), isNull(events.deletedAt)))
    .groupBy(events.id)
    .orderBy(desc(sql`min(${guests.createdAt})`));
  return rows.map((row) => ({
    eventId: row.eventId,
    name: row.name,
    slug: row.slug,
    eventDate: row.eventDate?.toISOString() ?? null,
    joinedAt: new Date(row.joinedAt).toISOString(),
    uploads: Number(row.uploads),
    ended: !row.isActive || (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()),
  }));
}

/**
 * ACC-4: "delete everything I uploaded" at one event, for every guest row this
 * account has there. The same erasure the in-gallery button does, reached from
 * an account instead of a cookie.
 */
export async function forgetGallery(userId: string, eventId: string): Promise<ErasureResult & { guests: number }> {
  const rows = await db
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.userId, userId), eq(guests.eventId, eventId)));
  const total = { mediaDeleted: 0, bytesDeleted: 0, guests: rows.length };
  for (const row of rows) {
    const result = await eraseGuest(row.id, eventId, userId, "account_guest_erasure");
    total.mediaDeleted += result.mediaDeleted;
    total.bytesDeleted += result.bytesDeleted;
  }
  return total;
}
