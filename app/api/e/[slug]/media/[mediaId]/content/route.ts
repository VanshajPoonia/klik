import { and, eq, isNull } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { resolveEventViewer } from "@/lib/event-viewer";
import { r2 } from "@/lib/storage";
import { canViewMedia } from "@/lib/media-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const plan = await getAccountPlan(event.ownerId);
  const viewer = await resolveEventViewer(event, plan.galleryAccessDays);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Not authorized to view this item" }, { status: 403 });
  }
  // Trashed media stays viewable to event managers and to nobody else, so the
  // trash screen can show thumbnails of what is about to be restored. Guests
  // see a 404 exactly as if the row were gone, which from their side it is.
  if (item.deletedAt && !viewer.ownerSession) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!viewer.ownerSession) {
    if (!viewer.guestId) {
      return NextResponse.json({ error: "Join the gallery to view media" }, { status: 401 });
    }
    // Same rule the grid query uses, from the same module, because a photo the
    // grid hides must not be served by its direct URL. 404 rather than 403: a
    // 403 confirms the photo exists, which for a hidden photo is already a
    // disclosure.
    if (!canViewMedia(item, { isManager: false, guestId: viewer.guestId }, event)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // ?poster=1 serves the still extracted at upload time instead of the video
  // itself. It goes through this same route so it inherits every access check
  // above: a poster frame of a private gallery is still that gallery's content.
  const wantsPoster =
    new URL(request.url).searchParams.get("poster") === "1" && item.posterPathname;
  if (wantsPoster) {
    const posterUrl = await getSignedUrl(
      r2,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: item.posterPathname!,
        ResponseContentType: "image/jpeg",
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: 60 * 60 },
    );
    return NextResponse.redirect(posterUrl, {
      status: 307,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  // A photo is one request, so a 60-second URL is plenty. Video is not: the
  // browser follows this redirect once, then issues range requests against the
  // resolved URL for the rest of playback, for buffering and for every seek.
  // With a 60-second signature those range requests start returning 403 from R2
  // one minute in, so any clip longer than that died mid-playback, and seeking
  // back into a watched video failed outright. The window has to cover a
  // plausible viewing session instead.
  //
  // The cost of the longer window is that the resolved URL is a bearer token
  // for that object while it lives, so it stays well short of the gallery
  // session and is still far tighter than making the bucket public.
  const isVideo = item.kind === "video";
  const contentUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: item.blobPathname,
      ResponseContentType: item.mimeType,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: isVideo ? 6 * 60 * 60 : 60 },
  );

  return NextResponse.redirect(contentUrl, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}
