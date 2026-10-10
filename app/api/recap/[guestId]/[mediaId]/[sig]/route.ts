import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, guests, media } from "@/lib/schema";
import { canViewMedia } from "@/lib/media-access";
import { signObjectUrl, SHARE_SIGNING_WINDOW_MS } from "@/lib/media-urls";
import { verifyRecapImage } from "@/lib/recap";

/**
 * GRW-1: a photo in a recap email. The link is signed for one guest and one
 * photo and never expires, so the photo is checked now, as a signed-out
 * visitor would see it: a photo the host has hidden, rejected or deleted since
 * the email went stops showing in it. Answers with a short signed redirect to
 * the grid tile, never the bytes, and nothing on the way is allowed to cache.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guestId: string; mediaId: string; sig: string }> },
) {
  const { guestId, mediaId, sig } = await params;
  const gone = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!verifyRecapImage(guestId, mediaId, sig)) return gone();

  const [row] = await db
    .select({
      kind: media.kind,
      status: media.status,
      visibility: media.visibility,
      guestId: media.guestId,
      blobPathname: media.blobPathname,
      thumbPathname: media.thumbPathname,
      mimeType: media.mimeType,
      uploaderSeesOwnPrivate: events.uploaderSeesOwnPrivate,
      disposableMode: events.disposableMode,
      developsAt: events.developsAt,
      purgedAt: events.purgedAt,
    })
    .from(media)
    .innerJoin(events, and(eq(events.id, media.eventId), isNull(events.deletedAt)))
    .innerJoin(guests, and(eq(guests.id, guestId), eq(guests.eventId, media.eventId)))
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .limit(1);
  if (!row || row.kind !== "photo" || row.purgedAt || !canViewMedia(row, { isManager: false, guestId: null }, row)) {
    return gone();
  }

  const url = await signObjectUrl(
    row.thumbPathname ?? row.blobPathname,
    row.thumbPathname ? "image/jpeg" : row.mimeType,
    Date.now(),
    SHARE_SIGNING_WINDOW_MS,
  );
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
