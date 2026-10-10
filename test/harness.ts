import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/lib/schema";
import { CURRENT_CONSENT } from "@/lib/consent";

/**
 * A real Postgres for the tests that cannot be written any other way.
 *
 * The suite in `lib/*.test.ts` covers pure logic and needs no database. This
 * one covers the opposite: the purge cron's circuit breaker, hard erasure, and
 * the co-host revocation predicate. All three are *queries*, and a test that
 * mocks the query away tests nothing. SEC-1 was exactly this kind of bug, a
 * correct-looking function resolving retention from the wrong column, and no
 * amount of unit testing around it would have caught it.
 *
 * **Driver note.** Production runs `neon-http`, which speaks HTTP to Neon and
 * cannot talk to a local server, so these tests use `node-postgres` against the
 * same schema. The SQL is identical, which is what is under test. The one real
 * difference is that `node-postgres` supports transactions and `neon-http` does
 * not, so **nothing in these tests may use `db.transaction()`**: it would pass
 * here and fail in production, which is worse than no test at all.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Start the throwaway database with scripts/test-db.sh.",
  );
}

// Guard against the obvious catastrophe. These tests TRUNCATE every table, so
// being pointed at anything that is not an explicitly named test database has
// to be impossible rather than merely unlikely.
if (!/\/klik_test(\?|$)/.test(url) || /neon\.tech/.test(url)) {
  throw new Error(
    `Refusing to run destructive tests against ${url}. The database must be named klik_test and must not be hosted on Neon.`,
  );
}

export const pool = new Pool({ connectionString: url, max: 4 });
export const testDb = drizzle(pool, { schema });

/** Every table, child-first, so truncation order never depends on cascade. */
const TABLES = [
  "jobs",
  "event_invites",
  "username_reservations",
  "audit_log",
  "event_slugs",
  "slug_reservations",
  "media_reports",
  // MED-9, before `media`, `guests` and `users`.
  "comment_reports",
  "media_comments",
  "media_reactions",
  "exports",
  // Before `events`, which points back at it.
  "entitlements",
  "erasure_log",
  "rate_limits",
  // VEN-2, before `guests`, `albums`, `events` and `users`.
  "kiosks",
  // QR-4, before `events` and `users`.
  "print_design_versions",
  "print_designs",
  "print_assets",
  // Before `media_shares` and `media`, both of which it references.
  "media_share_items",
  // Before `media`, `albums`, `guests` and `events`, all of which it references.
  "media_shares",
  "media",
  // GRW-3, after `media`, which points at it, and before `events`.
  "challenges",
  "event_co_hosts",
  "albums",
  "guests",
  "events",
  "venue_clients",
  "accounts",
  "sessions",
  '"verificationTokens"',
  // ACC-6, before `users`.
  "user_passkeys",
  "users",
];

export async function resetDatabase(): Promise<void> {
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(sequence += 1)}`;

/** Days from now, as a Date. Negative is in the past. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function makeUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? nextId("usr");
  await testDb.insert(schema.users).values({
    id,
    name: "Test Organizer",
    email: `${id}@example.test`,
    role: "organizer",
    planKey: "premium",
    ...overrides,
  });
  return id;
}

export async function makeEvent(
  ownerId: string,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? nextId("evt");
  await testDb.insert(schema.events).values({
    id,
    ownerId,
    slug: `${id}-slug`,
    name: "Test Event",
    visibility: "public",
    ...overrides,
  });
  return id;
}

export async function makeMedia(
  eventId: string,
  overrides: Partial<typeof schema.media.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? nextId("med");
  await testDb.insert(schema.media).values({
    id,
    eventId,
    kind: "photo",
    status: "approved",
    blobUrl: `/api/media/${id}`,
    blobPathname: `events/${eventId}/${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    ...overrides,
  });
  return id;
}

export async function makeGuest(
  eventId: string,
  overrides: Partial<typeof schema.guests.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? nextId("gst");
  await testDb.insert(schema.guests).values({
    id,
    eventId,
    displayName: "A Guest",
    // Not-null with no database default: consent is recorded by the session
    // route, never defaulted, so a guest row without it should not exist.
    consentedAt: new Date(),
    consentVersion: CURRENT_CONSENT.id,
    ...overrides,
  });
  return id;
}

export async function makeShare(
  eventId: string,
  overrides: Partial<typeof schema.mediaShares.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? nextId("shr");
  await testDb.insert(schema.mediaShares).values({
    id,
    token: `tok_${id}`,
    eventId,
    scope: "media",
    ...overrides,
  });
  return id;
}
