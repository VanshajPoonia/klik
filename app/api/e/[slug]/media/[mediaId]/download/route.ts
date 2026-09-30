import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { resolveEventViewer } from "@/lib/event-viewer";
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
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const viewer = await resolveEventViewer(event, plan.galleryAccessDays);

  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Not authorized to download this item" }, { status: 403 });
  }

  if (!viewer.ownerSession) {
    if (!event.downloadsEnabled) {
      return NextResponse.json(
        { error: "Downloads are disabled for this gallery" },
        { status: 403 },
      );
    }

    if (!viewer.guestId) {
      return NextResponse.json({ error: "Join the gallery before downloading" }, { status: 401 });
    }

    const canDownloadItem =
      item.status === "approved" ||
      (item.status === "pending" && item.guestId === viewer.guestId);
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
