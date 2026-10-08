import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { eraseGuestUpload } from "@/lib/erasure";
import { clientIp, consume } from "@/lib/ratelimit";

/**
 * MED-6: a guest deletes something they uploaded, from the gallery.
 *
 * Proved by the signed per-event cookie they already hold, the same proof that
 * attributed the upload to them in the first place, so no account is needed.
 * Organizers delete through the dashboard instead, into the trash.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limit = await consume(`guest-delete:ip:${clientIp(request)}`, 60, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many deletions. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const viewer = await resolveEventViewer(event);
  if (!viewer.guestId) {
    return NextResponse.json({ error: "Join the gallery to manage your uploads" }, { status: 401 });
  }

  const result = await eraseGuestUpload(viewer.guestId, event.id, mediaId);
  // 404 whether it does not exist or is somebody else's: a 403 would confirm
  // that a photo with this id is in the gallery.
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
