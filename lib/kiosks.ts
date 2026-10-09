import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { events, guests, kiosks, media, type Kiosk } from "./schema";
import { CURRENT_CONSENT } from "./consent";

/**
 * VEN-2: kiosk mode. A tablet at the venue entrance that takes photos and
 * does nothing else.
 *
 * **The tablet never holds the host's sign-in.** The host makes a kiosk on the
 * dashboard and gets a one-time pairing link; the tablet opens it, confirms
 * with a tap, and is given a guest cookie for the kiosk's own guest row with a
 * `kioskId` claim. From then on its uploads are a guest's: moderated, counted
 * against storage, reportable and erasable, through the same routes as every
 * phone. What makes it a kiosk is enforced on the server, not just by the
 * screen: a kiosk is sent back to the kiosk page from the gallery, cannot
 * delete photos (every kiosk photo is "its own"), is never claimed by an
 * account, and is shut out the moment the host switches it off, because every
 * request carrying the claim checks this row.
 *
 * The pairing code is 24 random bytes, kept only as a SHA-256 hash, valid for
 * thirty minutes, and spent by one conditional update, so two tablets racing
 * for one link cannot both win.
 */

export const KIOSK_PAIR_MINUTES = 30;
export const MAX_KIOSKS_PER_EVENT = 10;
/** A kiosk is many guests in a queue, so it gets more uploads an hour than one phone. */
export const KIOSK_UPLOADS_PER_HOUR = 600;

export const hashPairCode = (code: string) => createHash("sha256").update(code).digest("hex");

/** Shaped like a code before anything touches the database. */
export function isPairCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

function newPairCode(): { code: string; hash: string; expiresAt: Date } {
  const code = randomBytes(24).toString("base64url");
  return { code, hash: hashPairCode(code), expiresAt: new Date(Date.now() + KIOSK_PAIR_MINUTES * 60_000) };
}

export class KioskLimitError extends Error {}

/** Makes a kiosk, its guest row and a first pairing code. */
export async function createKiosk(input: {
  eventId: string;
  name: string;
  albumId: string | null;
  createdBy: string | null;
}): Promise<{ kiosk: Kiosk; code: string }> {
  const [{ live }] = await db
    .select({ live: count() })
    .from(kiosks)
    .where(and(eq(kiosks.eventId, input.eventId), isNull(kiosks.revokedAt)));
  if (live >= MAX_KIOSKS_PER_EVENT) throw new KioskLimitError();

  const guestId = nanoid();
  // The kiosk's uploads are the guests' who stand in front of it. Each of them
  // agrees on its start screen; this row records the version they are shown.
  await db.insert(guests).values({
    id: guestId,
    eventId: input.eventId,
    displayName: input.name,
    consentedAt: new Date(),
    consentVersion: CURRENT_CONSENT.id,
  });
  const pairing = newPairCode();
  try {
    const [kiosk] = await db
      .insert(kiosks)
      .values({
        id: nanoid(),
        eventId: input.eventId,
        guestId,
        name: input.name,
        albumId: input.albumId,
        createdBy: input.createdBy,
        pairCodeHash: pairing.hash,
        pairExpiresAt: pairing.expiresAt,
      })
      .returning();
    return { kiosk, code: pairing.code };
  } catch (error) {
    // No transactions on neon-http: take the guest row back by hand.
    await db.delete(guests).where(eq(guests.id, guestId));
    throw error;
  }
}

/** A fresh pairing code for a kiosk that is still on, replacing any unused one. */
export async function renewPairCode(eventId: string, kioskId: string): Promise<string | null> {
  const pairing = newPairCode();
  const [row] = await db
    .update(kiosks)
    .set({ pairCodeHash: pairing.hash, pairExpiresAt: pairing.expiresAt })
    .where(and(eq(kiosks.id, kioskId), eq(kiosks.eventId, eventId), isNull(kiosks.revokedAt)))
    .returning({ id: kiosks.id });
  return row ? pairing.code : null;
}

/** What a pairing link points at, without spending it, for the confirm screen. */
export async function findPairing(code: string) {
  if (!isPairCode(code)) return null;
  const [row] = await db
    .select({ kioskName: kiosks.name, eventName: events.name, slug: events.slug })
    .from(kiosks)
    .innerJoin(events, eq(events.id, kiosks.eventId))
    .where(
      and(
        eq(kiosks.pairCodeHash, hashPairCode(code)),
        gt(kiosks.pairExpiresAt, sql`now()`),
        isNull(kiosks.revokedAt),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Spends a pairing code. One statement, so only one tablet can have it. */
export async function pairKiosk(code: string): Promise<Kiosk | null> {
  if (!isPairCode(code)) return null;
  const [kiosk] = await db
    .update(kiosks)
    .set({ pairCodeHash: null, pairExpiresAt: null, pairedAt: sql`now()`, lastSeenAt: sql`now()` })
    .where(
      and(eq(kiosks.pairCodeHash, hashPairCode(code)), gt(kiosks.pairExpiresAt, sql`now()`), isNull(kiosks.revokedAt)),
    )
    .returning();
  return kiosk ?? null;
}

/**
 * The kiosk a cookie claims to be, when it still is one: same event, same
 * guest, not switched off. Anything else and the cookie is worth nothing.
 */
export async function activeKiosk(claim: { kioskId: string; guestId: string; eventId: string }): Promise<Kiosk | null> {
  const [kiosk] = await db
    .select()
    .from(kiosks)
    .where(
      and(
        eq(kiosks.id, claim.kioskId),
        eq(kiosks.guestId, claim.guestId),
        eq(kiosks.eventId, claim.eventId),
        isNull(kiosks.revokedAt),
      ),
    )
    .limit(1);
  return kiosk ?? null;
}

export async function touchKiosk(kioskId: string): Promise<void> {
  await db.update(kiosks).set({ lastSeenAt: sql`now()` }).where(eq(kiosks.id, kioskId));
}

/** Switches a kiosk off. Its tablet is shut out at its next request. */
export async function revokeKiosk(eventId: string, kioskId: string): Promise<Kiosk | null> {
  const [kiosk] = await db
    .update(kiosks)
    .set({ revokedAt: sql`now()`, pairCodeHash: null, pairExpiresAt: null })
    .where(and(eq(kiosks.id, kioskId), eq(kiosks.eventId, eventId), isNull(kiosks.revokedAt)))
    .returning();
  return kiosk ?? null;
}

export interface KioskSummary {
  id: string;
  name: string;
  albumId: string | null;
  createdAt: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  /** Unused and unexpired: the link can still be opened on a tablet. */
  pairingOpen: boolean;
  photos: number;
}

export async function listKiosks(eventId: string): Promise<KioskSummary[]> {
  const rows = await db
    .select({
      id: kiosks.id,
      name: kiosks.name,
      albumId: kiosks.albumId,
      createdAt: kiosks.createdAt,
      pairedAt: kiosks.pairedAt,
      lastSeenAt: kiosks.lastSeenAt,
      revokedAt: kiosks.revokedAt,
      pairingOpen: sql<boolean>`coalesce("kiosks"."pair_expires_at" > now(), false)`,
      photos: sql<number>`(select count(*)::int from ${media} where "media"."guest_id" = "kiosks"."guest_id" and "media"."deleted_at" is null)`,
    })
    .from(kiosks)
    .where(eq(kiosks.eventId, eventId))
    .orderBy(asc(kiosks.createdAt));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    pairedAt: row.pairedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    pairingOpen: Boolean(row.pairingOpen),
    photos: Number(row.photos),
  }));
}
