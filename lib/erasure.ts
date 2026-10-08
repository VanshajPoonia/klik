import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { erasureLog, events, guests, media, users } from "./schema";
import { deleteBlobs } from "./storage";
import { MEDIA_OBJECT_COLUMNS, mediaObjectKeys, type MediaObjectRow } from "./media-objects";

/**
 * Hard deletion, as distinct from the soft delete in the DELETE routes.
 *
 * Soft delete exists so a mis-click is recoverable: the row keeps its bytes for
 * 30 days and the purge cron finishes the job later. Erasure is the opposite
 * promise. When someone asks to be removed, "we moved it to a trash folder" is
 * not removal, so nothing here is recoverable and nothing waits 30 days.
 *
 * Ordering differs from the purge cron on purpose. The cron deletes rows first,
 * because a crash between the two steps should leave sweepable orphans rather
 * than a gallery of broken images. Erasure deletes **bytes first**, because the
 * failure it must never produce is telling someone their data is gone while it
 * is still sitting in the bucket. If the object delete fails the whole operation
 * aborts with the rows intact, so a retry still knows what it was meant to
 * remove.
 */

export type ErasureSubject = "user" | "guest" | "event";

export interface ErasureResult {
  mediaDeleted: number;
  bytesDeleted: number;
}

/**
 * Identifiers are hashed before they are logged. The log exists to prove an
 * erasure happened, which does not require keeping a pointer to the person who
 * asked for it. Storing the raw id would recreate, in the audit trail, exactly
 * the record the request was meant to remove.
 */
function hashSubject(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

async function recordErasure(
  subject: ErasureSubject,
  subjectId: string,
  result: ErasureResult,
  requestedBy: string | null,
  reason: string,
): Promise<void> {
  await db.insert(erasureLog).values({
    id: crypto.randomUUID(),
    subjectType: subject,
    subjectHash: hashSubject(subjectId),
    mediaDeleted: result.mediaDeleted,
    bytesDeleted: result.bytesDeleted,
    requestedBy,
    reason,
  });
}

/** Removes the objects for these rows, including any that were soft-deleted. */
async function eraseMediaRows(
  rows: Array<MediaObjectRow & { id: string; sizeBytes: number }>,
): Promise<ErasureResult> {
  if (rows.length === 0) return { mediaDeleted: 0, bytesDeleted: 0 };

  // Posters and thumbnails are separate objects, so every one a row owns has
  // to be named, or a photo's thumbnail outlives the photo it was made from.
  // The list is lib/media-objects.ts, which a test holds to the schema.
  await deleteBlobs(mediaObjectKeys(rows));
  await db.delete(media).where(
    inArray(
      media.id,
      rows.map((row) => row.id),
    ),
  );

  return {
    mediaDeleted: rows.length,
    bytesDeleted: rows.reduce((total, row) => total + Number(row.sizeBytes ?? 0), 0),
  };
}

/**
 * Erases one event: every photo and video including soft-deleted ones, every
 * guest record, and the event row itself. Albums and co-host rows go with it
 * through the foreign keys.
 */
export async function eraseEvent(
  eventId: string,
  requestedBy: string | null,
  reason = "event_erasure",
): Promise<ErasureResult> {
  const rows = await db
    .select({
      id: media.id,
      ...MEDIA_OBJECT_COLUMNS,
      sizeBytes: media.sizeBytes,
    })
    .from(media)
    .where(eq(media.eventId, eventId));

  const result = await eraseMediaRows(rows);
  await db.delete(guests).where(eq(guests.eventId, eventId));
  await db.delete(events).where(eq(events.id, eventId));
  await recordErasure("event", eventId, result, requestedBy, reason);
  return result;
}

/**
 * Erases one guest's contribution to an event: their uploads, their objects,
 * and the guest row carrying their display name and consent timestamp.
 */
export async function eraseGuest(
  guestId: string,
  eventId: string,
  requestedBy: string | null,
  reason = "guest_erasure",
): Promise<ErasureResult> {
  const rows = await db
    .select({
      id: media.id,
      ...MEDIA_OBJECT_COLUMNS,
      sizeBytes: media.sizeBytes,
    })
    .from(media)
    .where(and(eq(media.guestId, guestId), eq(media.eventId, eventId)));

  const result = await eraseMediaRows(rows);
  await db.delete(guests).where(and(eq(guests.id, guestId), eq(guests.eventId, eventId)));

  // A deleted guest's uploads are gone, so any event still pointing at one of
  // them as its cover needs that pointer cleared or the gallery renders a hole.
  await db
    .update(events)
    .set({ coverMediaId: null, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.coverMediaId, rows[0]?.id ?? "")));

  await recordErasure("guest", guestId, result, requestedBy, reason);
  return result;
}

/**
 * Erases an account and everything it owns. The foreign keys cascade the
 * database side (events, guests, albums, co-host rows, venue clients, OAuth
 * accounts and sessions), but **R2 knows nothing about foreign keys**, so the
 * objects have to be collected and deleted explicitly first or the bytes
 * outlive the account that owned them.
 */
export async function eraseUser(
  userId: string,
  requestedBy: string | null,
  reason = "account_erasure",
): Promise<ErasureResult> {
  const ownedEvents = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.ownerId, userId));

  const total: ErasureResult = { mediaDeleted: 0, bytesDeleted: 0 };

  if (ownedEvents.length > 0) {
    const rows = await db
      .select({
      id: media.id,
      ...MEDIA_OBJECT_COLUMNS,
      sizeBytes: media.sizeBytes,
    })
      .from(media)
      .where(
        inArray(
          media.eventId,
          ownedEvents.map((event) => event.id),
        ),
      );
    const result = await eraseMediaRows(rows);
    total.mediaDeleted += result.mediaDeleted;
    total.bytesDeleted += result.bytesDeleted;
  }

  await db.delete(users).where(eq(users.id, userId));
  await recordErasure("user", userId, total, requestedBy, reason);
  return total;
}
