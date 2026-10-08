import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { erasureLog, events, guests, media, users, eventInvites } from "./schema";
import { deleteBlobs } from "./storage";
import { MEDIA_OBJECT_COLUMNS, mediaObjectKeys, type MediaObjectRow } from "./media-objects";
import { deleteEventExports, deleteExportsContaining } from "./exports";
import { hasLegalHold } from "./reports";

/**
 * Thrown instead of erasing anything under a legal hold (TRS-1). A child-safety
 * report freezes the material because the law requires it be preserved, and an
 * erasure request does not override that. A superadmin resolves it by hand.
 */
export class LegalHoldError extends Error {
  constructor() {
    super("Some of this is under a legal hold and cannot be erased until it is resolved.");
    this.name = "LegalHoldError";
  }
}

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
  if (await hasLegalHold({ eventIds: [eventId] })) throw new LegalHoldError();
  const rows = await db
    .select({
      id: media.id,
      ...MEDIA_OBJECT_COLUMNS,
      sizeBytes: media.sizeBytes,
    })
    .from(media)
    .where(eq(media.eventId, eventId));

  const result = await eraseMediaRows(rows);
  // A ZIP of the gallery is the gallery. Exports are deleted, not left to
  // expire, because "gone within a week" is not what erasure promises.
  await deleteEventExports([eventId]);
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
  if (await hasLegalHold({ mediaIds: rows.map((row) => row.id) })) throw new LegalHoldError();

  const result = await eraseMediaRows(rows);
  // Any export holding one of their uploads goes too: leaving their photos in a
  // ZIP for a week is not an erasure. Exports that never held them stay.
  await deleteExportsContaining(eventId, rows.map((row) => row.id));
  await db.delete(guests).where(and(eq(guests.id, guestId), eq(guests.eventId, eventId)));

  // A deleted guest's uploads are gone, so any event still pointing at one of
  // them as its cover needs that pointer cleared or the gallery renders a hole.
  // Any of them, not only the first: the cover is whichever one the host chose.
  if (rows.length > 0) {
    await db
      .update(events)
      .set({ coverMediaId: null, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), inArray(events.coverMediaId, rows.map((row) => row.id))));
  }

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
  if (await hasLegalHold({ eventIds: ownedEvents.map((event) => event.id) })) throw new LegalHoldError();
  // ACC-1: what this person shared as a guest at other people's events is
  // theirs too, and "remove me" covers it. Checked for holds before anything
  // is deleted, so a hold on one upload cannot leave the erasure half done.
  const guestRows = await db
    .select({ id: guests.id, eventId: guests.eventId })
    .from(guests)
    .where(eq(guests.userId, userId));
  if (guestRows.length > 0) {
    const shared = await db
      .select({ id: media.id })
      .from(media)
      .where(inArray(media.guestId, guestRows.map((row) => row.id)));
    if (await hasLegalHold({ mediaIds: shared.map((row) => row.id) })) throw new LegalHoldError();
  }

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
    // Before the cascade takes the export rows, which are the only record of
    // where the ZIPs are.
    await deleteEventExports(ownedEvents.map((event) => event.id));
  }

  const ownedIds = new Set(ownedEvents.map((event) => event.id));
  for (const row of guestRows) {
    // Owned events went above, guests and all.
    if (ownedIds.has(row.eventId)) continue;
    const result = await eraseGuest(row.id, row.eventId, requestedBy, `${reason}:guest`);
    total.mediaDeleted += result.mediaDeleted;
    total.bytesDeleted += result.bytesDeleted;
  }

  // ORG-3: invitations are addressed to an email, not an account, so no foreign
  // key takes them. One sent to this person is their address in somebody
  // else's table.
  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (account?.email) {
    await db.delete(eventInvites).where(eq(eventInvites.email, account.email.trim().toLowerCase()));
  }

  await db.delete(users).where(eq(users.id, userId));
  await recordErasure("user", userId, total, requestedBy, reason);
  return total;
}

/**
 * MED-6: a guest removes one thing they uploaded.
 *
 * Erased, not soft-deleted. A soft delete would put it in the organizer's trash,
 * and the organizer could restore it, which would turn "delete my photo" into
 * "ask the host whether my photo may stay". The Privacy Policy promises guests
 * they can delete their own uploads, and this is that promise kept.
 *
 * Returns null when the photo is not theirs, so the caller can answer 404
 * without saying whether it exists.
 */
export async function eraseGuestUpload(
  guestId: string,
  eventId: string,
  mediaId: string,
): Promise<ErasureResult | null> {
  const rows = await db
    .select({ id: media.id, ...MEDIA_OBJECT_COLUMNS, sizeBytes: media.sizeBytes })
    .from(media)
    .where(
      and(
        eq(media.id, mediaId),
        eq(media.eventId, eventId),
        eq(media.guestId, guestId),
        // Under a legal hold it stays, whoever asks. See LegalHoldError.
        isNull(media.legalHoldAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;

  const result = await eraseMediaRows(rows);
  await deleteExportsContaining(eventId, [mediaId]);
  await db
    .update(events)
    .set({ coverMediaId: null, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.coverMediaId, mediaId)));
  await recordErasure("guest", guestId, result, null, "guest_removed_upload");
  return result;
}
