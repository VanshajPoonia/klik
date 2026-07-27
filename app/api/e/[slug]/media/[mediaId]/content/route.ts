import { and, eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { resolveEventViewer } from "@/lib/event-viewer";
import { r2 } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
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
  if (!viewer.ownerSession) {
    if (!viewer.guestId) {
      return NextResponse.json({ error: "Join the gallery to view media" }, { status: 401 });
    }
    const visible =
      item.status === "approved" ||
      (item.status === "pending" && item.guestId === viewer.guestId);
    if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: item.blobPathname,
      ResponseContentType: item.mimeType,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: 60 },
  );

  return NextResponse.redirect(contentUrl, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}
