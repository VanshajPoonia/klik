import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { eventSlugs, events, type Event } from "./schema";

/**
 * QR-1: an event's address, `/e/<slug>`, can change without breaking anything
 * printed. Every former address keeps serving the gallery, and no address ever
 * goes back into the pool, even after the event is deleted: a QR code laminated
 * onto a table must never start leading to a stranger's gallery. The database
 * enforces both (drizzle/0023_slugs.sql); this file is the readable half.
 */

/**
 * Words a custom address may not be: every top-level route, and the ones that
 * would let somebody pass off a gallery as part of Klik itself.
 */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "e", "v", "s", "u", "me", "new", "edit", "live", "dashboard", "login",
  "logout", "signup", "settings", "pricing", "privacy", "terms", "support", "help", "about",
  "checkout", "billing", "klik", "www", "app", "official", "staff", "team", "security",
]);

export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: string };

/** Lowercase letters, digits and single hyphens, 3 to 60 characters. */
export function validateCustomSlug(input: string): SlugCheck {
  const slug = input.trim().toLowerCase();
  if (slug.length < 3) return { ok: false, reason: "Use at least 3 characters." };
  if (slug.length > 60) return { ok: false, reason: "Use at most 60 characters." };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, reason: "Use only letters, numbers and hyphens." };
  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return { ok: false, reason: "Hyphens go between words, one at a time." };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "That address is reserved." };
  return { ok: true, slug };
}

/**
 * The event at this address, current or former. Never a deleted event: its
 * addresses are reserved, not served.
 */
export async function findEventBySlug(slug: string): Promise<{ event: Event; viaAlias: boolean } | null> {
  const [current] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (current) return { event: current, viaAlias: false };

  const [former] = await db
    .select({ event: events })
    .from(eventSlugs)
    .innerJoin(events, eq(events.id, eventSlugs.eventId))
    .where(and(eq(eventSlugs.slug, slug.toLowerCase()), isNull(events.deletedAt)))
    .limit(1);
  return former ? { event: former.event, viaAlias: true } : null;
}

export async function listFormerSlugs(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: eventSlugs.slug })
    .from(eventSlugs)
    .where(eq(eventSlugs.eventId, eventId))
    .orderBy(asc(eventSlugs.createdAt));
  return rows.map((row) => row.slug);
}

/**
 * Moves an event to a new address, keeping the old one as a working alias.
 *
 * One statement. Doing it as "update, then insert the old address" would leave
 * the old address unreserved for the moment between the two, which is exactly
 * when someone else could claim it. Switching back to a former address takes
 * it out of the alias list in the same statement.
 */
export async function changeEventSlug(
  eventId: string,
  newSlug: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await db.execute(sql`
      WITH old AS (SELECT slug FROM events WHERE id = ${eventId}),
      reclaimed AS (DELETE FROM event_slugs WHERE slug = ${newSlug} AND event_id = ${eventId}),
      kept AS (
        INSERT INTO event_slugs (slug, event_id)
        SELECT slug, ${eventId} FROM old WHERE slug <> ${newSlug}
        ON CONFLICT (slug) DO NOTHING
      )
      UPDATE events SET slug = ${newSlug}, updated_at = now() WHERE id = ${eventId}
    `);
    return { ok: true };
  } catch (error) {
    const text = [error, (error as { cause?: unknown })?.cause].map(String).join(" ");
    if (text.includes("slug_taken") || text.includes("events_slug_unique") || text.includes("duplicate key")) {
      return { ok: false, reason: "That address is taken. Try another." };
    }
    throw error;
  }
}
