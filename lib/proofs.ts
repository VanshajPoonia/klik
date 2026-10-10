import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { media, users, watermarks } from "./schema";
import { deleteBlobs, proofPathnameFor } from "./storage";
import { enqueue } from "./jobs";
import { signObjectUrl } from "./media-urls";
import type { WatermarkProfile } from "./watermark-settings";

/**
 * MED-10: watermarked proofs.
 *
 * A photographer on an event's team uploads proofs. Each one is stored twice:
 * the clean original, and a copy with their watermark. **While a proof is
 * locked, `media.blob_pathname` names the watermarked copy**, and the original
 * sits in `proof_original_pathname`, which no delivery path reads. So every
 * route that serves a photo, the grid, share links, the live display, ZIPs,
 * exports, link previews, and whatever is added next, serves the watermark by
 * default, without knowing proofs exist. The clean photo is reachable in
 * exactly two places, both through `cleanOriginalFor`: the dashboard's own
 * view and the content and download routes, and only for the photographer.
 *
 * Stamping is lib/proof-stamp.ts, apart from this file because it loads sharp
 * and every route that imports it needs the libvips tracing include.
 *
 * Releasing is the photographer's decision alone, made when they have been
 * paid, however they are paid: Klik takes no money for it. The event's owner
 * cannot release a proof, because the owner is usually the client.
 */

export type Watermark = typeof watermarks.$inferSelect;

/** Every release does at most this many, so one request stays short. The page asks again for the rest. */
export const RELEASE_BATCH = 500;

export async function getWatermark(userId: string): Promise<Watermark | null> {
  const [row] = await db.select().from(watermarks).where(eq(watermarks.userId, userId)).limit(1);
  return row ?? null;
}

export { cleanOriginalFor, isLockedProof } from "./proof-access";

/** MED-10: the account page's view of a photographer's watermark, or null. */
export async function watermarkProfile(userId: string): Promise<WatermarkProfile | null> {
  const [row] = await db.select().from(watermarks).where(eq(watermarks.userId, userId)).limit(1);
  if (!row) return null;
  const now = Date.now();
  return {
    label: row.label,
    font: row.font,
    position: row.position,
    opacity: row.opacity,
    scale: row.scale,
    buyNote: row.buyNote,
    buyUrl: row.buyUrl,
    stampUrl: await signObjectUrl(row.stampKey, "image/png", now),
    stampWidth: row.stampWidth,
    stampHeight: row.stampHeight,
    logoUrl: row.logoKey ? `/api/me/watermark/logo?v=${encodeURIComponent(row.logoKey.slice(-12))}` : null,
  };
}

/**
 * Releases locked proofs: the original becomes what everyone is served, and
 * the watermarked copy is deleted. `mediaIds` null means every one of this
 * photographer's proofs in the event, up to `RELEASE_BATCH` per call.
 *
 * One UPDATE, so a photo is never half released: `blob_pathname` takes the
 * original's key in the same statement that clears it. The grid tile is
 * cleared too and remade from the clean photo by the thumbnail job.
 */
export async function releaseProofs({
  eventId,
  userId,
  mediaIds,
  anyPhotographer = false,
}: {
  eventId: string;
  userId: string;
  mediaIds: string[] | null;
  /** A superadmin, for a photographer who has left and cannot release their own. */
  anyPhotographer?: boolean;
}): Promise<{ released: string[]; more: boolean }> {
  const locked = and(
    eq(media.eventId, eventId),
    isNotNull(media.proofOriginalPathname),
    isNull(media.proofReleasedAt),
    anyPhotographer ? undefined : eq(media.proofBy, userId),
  );
  const candidates = await db
    .select({ id: media.id })
    .from(media)
    .where(and(locked, mediaIds ? inArray(media.id, mediaIds.slice(0, RELEASE_BATCH)) : undefined))
    .limit(RELEASE_BATCH + 1);
  const batch = candidates.slice(0, RELEASE_BATCH).map((row) => row.id);
  if (batch.length === 0) return { released: [], more: false };

  const released = await db
    .update(media)
    .set({
      blobPathname: sql`${media.proofOriginalPathname}`,
      proofOriginalPathname: null,
      proofReleasedAt: sql`now()`,
      thumbPathname: null,
    })
    .where(and(locked, inArray(media.id, batch)))
    .returning({ id: media.id });
  const ids = released.map((row) => row.id);

  // After the swap, so a failure here leaves orphans the reaper sweeps, never
  // a row pointing at a deleted object.
  await deleteBlobs(ids.map((id) => proofPathnameFor(eventId, id))).catch(() => undefined);
  await enqueue("media.backfill_thumbnails", {}, { dedupeKey: "thumbs:backfill" }).catch(() => undefined);
  return { released: ids, more: candidates.length > RELEASE_BATCH };
}

/** What a viewer of a locked proof is told: whose it is and how to get the clean one. */
export async function proofNote(mediaId: string, eventId: string) {
  const [row] = await db
    .select({
      label: watermarks.label,
      buyNote: watermarks.buyNote,
      buyUrl: watermarks.buyUrl,
      name: users.name,
    })
    .from(media)
    .innerJoin(users, eq(users.id, media.proofBy))
    .leftJoin(watermarks, eq(watermarks.userId, media.proofBy))
    .where(
      and(eq(media.id, mediaId), eq(media.eventId, eventId), isNotNull(media.proofOriginalPathname), isNull(media.proofReleasedAt)),
    )
    .limit(1);
  if (!row) return null;
  return { by: row.label ?? row.name ?? "The photographer", note: row.buyNote, url: row.buyUrl };
}
