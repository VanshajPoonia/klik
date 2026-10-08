import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { events, media } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { extensionForMime, r2 } from "@/lib/storage";
import { canViewMedia } from "@/lib/media-access";

function downloadFilename(slug: string, mimeType: string, mediaId: string) {
  const extension = extensionForMime(mimeType);
  return `${slug}-${mediaId.slice(0, 8)}.${extension}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const viewer = await resolveEventViewer(event);

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

    // The third place this rule is enforced, and the one most likely to be
    // forgotten. Downloading is viewing with a file attached.
    if (!canViewMedia(item, { isManager: false, guestId: viewer.guestId }, event)) {
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
