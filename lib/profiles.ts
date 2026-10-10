import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { events, usernameReservations, users } from "./schema";
import { isEventActive } from "./access";

/**
 * GRW-4: a public profile at /u/<username>. Off until the account turns it
 * on, and it lists only the events its owner chose, by name and date. It
 * never shows a photo: guests agreed to their photos being seen in the
 * gallery, not on someone's page about themselves (ROADMAP.md LAW-4). Each
 * listing links to the gallery, whose own access rules then apply.
 */

export const PROFILE_LIMITS = { bio: 280, website: 300, events: 60 } as const;

/** https only: this link sits on a page any stranger can open. */
export function normalizeWebsite(raw: string | null | undefined): { ok: true; url: string | null } | { ok: false } {
  const value = raw?.trim() ?? "";
  if (!value) return { ok: true, url: null };
  if (value.length > PROFILE_LIMITS.website) return { ok: false };
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return { ok: false };
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false };
  }
}

/** "October 12, 2026". Event dates are calendar days stored at midnight UTC. */
export function formatEventDay(date: Date): string {
  return date.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export type ListedEvent = { slug: string; name: string; eventDate: Date | null; needsPassword: boolean };

export type ProfileLookup =
  | { kind: "profile"; name: string | null; username: string; bio: string | null; website: string | null; events: ListedEvent[] }
  | { kind: "moved"; username: string }
  | null;

/**
 * The profile behind a handle, or where a recently changed handle went. A
 * handle given up in the last 30 days is parked (ID-1), so an old link to a
 * profile follows its owner rather than breaking or reaching someone new.
 */
export async function profileFor(handle: string, now = new Date()): Promise<ProfileLookup> {
  const lower = handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(lower)) return null;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      bio: users.profileBio,
      website: users.profileWebsite,
      isPublic: users.profilePublic,
    })
    .from(users)
    .where(sql`lower(${users.username}) = ${lower}`)
    .limit(1);

  if (!user) {
    const [parked] = await db
      .select({ username: users.username, isPublic: users.profilePublic })
      .from(usernameReservations)
      .innerJoin(users, eq(users.id, usernameReservations.userId))
      .where(
        and(
          eq(usernameReservations.usernameLower, lower),
          eq(usernameReservations.reason, "changed"),
          gt(usernameReservations.releasedAt, now),
        ),
      )
      .limit(1);
    return parked?.isPublic && parked.username ? { kind: "moved", username: parked.username } : null;
  }
  if (!user.isPublic || !user.username) return null;

  const rows = await db
    .select({
      slug: events.slug,
      name: events.name,
      eventDate: events.eventDate,
      visibility: events.visibility,
      isActive: events.isActive,
      expiresAt: events.expiresAt,
    })
    .from(events)
    .where(
      and(
        eq(events.ownerId, user.id),
        eq(events.showOnProfile, true),
        isNull(events.deletedAt),
        isNull(events.purgedAt),
        ne(events.visibility, "private"),
        // Live: never a draft nobody can open yet, nor a lapsed one.
        isNotNull(events.entitlementId),
      ),
    )
    .orderBy(sql`${events.eventDate} DESC NULLS LAST`, desc(events.createdAt))
    .limit(PROFILE_LIMITS.events);

  return {
    kind: "profile",
    name: user.name,
    username: user.username,
    bio: user.bio,
    website: user.website,
    events: rows
      .filter((row) => isEventActive(row, now))
      .map((row) => ({ slug: row.slug, name: row.name, eventDate: row.eventDate, needsPassword: row.visibility === "password" })),
  };
}
