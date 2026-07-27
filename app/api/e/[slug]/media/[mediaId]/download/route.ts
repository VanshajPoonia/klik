import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { canViewGallery } from "@/lib/access";
import { getAccountPlan } from "@/lib/account-plans";
import {
  eventUnlockCookieName,
  guestCookieName,
  verifyEventUnlock,
  verifyGuestSession,
} from "@/lib/guest";
import { requireOwnerSession } from "@/lib/roles";
import { extensionForMime, r2 } from "@/lib/storage";

function downloadFilename(slug: string, mimeType: string, mediaId: string) {
  const extension = extensionForMime(mimeType);
  return `${slug}-${mediaId.slice(0, 8)}.${extension}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerSession = await requireOwnerSession(event.ownerId);
  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie ? await verifyEventUnlock(unlockCookie, event.id) : false;
  const access = canViewGallery(event, {
    isOwner: Boolean(ownerSession),
    hasUnlockCookie,
    galleryAccessDays: plan.galleryAccessDays,
  });

  if (!access.allowed) {
    return NextResponse.json({ error: "Not authorized to download this item" }, { status: 403 });
  }

  if (!ownerSession) {
    if (!event.downloadsEnabled) {
      return NextResponse.json(
        { error: "Downloads are disabled for this gallery" },
        { status: 403 },
      );
    }

    const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
    const guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
    if (!guestSession || guestSession.eventId !== event.id) {
      return NextResponse.json({ error: "Join the gallery before downloading" }, { status: 401 });
    }

    const canDownloadItem =
      item.status === "approved" ||
      (item.status === "pending" && item.guestId === guestSession.guestId);
    if (!canDownloadItem) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: item.blobPathname,
    ResponseContentType: item.mimeType,
    ResponseContentDisposition: `attachment; filename="${downloadFilename(
      event.slug,
      item.mimeType,
      item.id,
    )}"`,
  });
  const downloadUrl = await getSignedUrl(r2, command, { expiresIn: 60 });

  return NextResponse.redirect(downloadUrl, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}
