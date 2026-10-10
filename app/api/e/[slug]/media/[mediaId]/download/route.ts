import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { events, media } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { extensionForMime, r2 } from "@/lib/storage";
import { canViewMedia, videoHeldBack } from "@/lib/media-access";
import { cleanOriginalFor } from "@/lib/proof-access";

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
    if (!viewer.guestId) {
      return NextResponse.json({ error: "Join the gallery before downloading" }, { status: 401 });
    }

    // CAM-3: the switch keeps guests from taking each other's photos. A
    // guest's own upload came from their phone and stays theirs to save.
    if (!event.downloadsEnabled && item.guestId !== viewer.guestId) {
      return NextResponse.json(
        { error: "Downloads are disabled for this gallery" },
        { status: 403 },
      );
    }

    // The third place this rule is enforced, and the one most likely to be
    // forgotten. Downloading is viewing with a file attached.
    if (!canViewMedia(item, { isManager: false, guestId: viewer.guestId }, event)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // MED-8: a video still being cleaned of its location, or that could not be,
  // plays only for the guest who filmed it.
  if (videoHeldBack(item, { isManager: Boolean(viewer.ownerSession), guestId: viewer.guestId })) {
    return NextResponse.json({ error: "This video is still being prepared. Try again in a minute." }, { status: 409 });
  }

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    // MED-10: the photographer downloads their own proof clean; everyone
    // else, the event's owner included, gets the watermarked copy.
    Key: cleanOriginalFor(item, viewer.ownerSession?.user?.id) ?? item.blobPathname,
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
