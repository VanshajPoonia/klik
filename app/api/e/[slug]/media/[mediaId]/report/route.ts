import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, REPORT_REASONS } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { canViewMedia } from "@/lib/media-access";
import { fileReport } from "@/lib/reports";
import { clientIp, consume } from "@/lib/ratelimit";

const requestSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
});

/**
 * TRS-1: anyone who can see a photo can report it. See lib/reports.ts for what
 * a report does. Only what the reporter can see is reportable, and a photo they
 * cannot see answers 404, so this cannot be used to discover hidden media.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> },
) {
  const { slug, mediaId } = await params;
  const limit = await consume(`report:ip:${clientIp(request)}`, 20, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reports from here. Try again later, or email us." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a reason" }, { status: 400 });

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed || (!viewer.guestId && !viewer.ownerSession)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!item || !canViewMedia(item, { isManager: Boolean(viewer.ownerSession), guestId: viewer.guestId }, event)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await fileReport({
    eventId: event.id,
    mediaId,
    reason: parsed.data.reason,
    note: parsed.data.note,
    reporter: {
      guestId: viewer.guestId,
      userId: viewer.ownerSession?.user?.id ?? null,
      ip: clientIp(request),
    },
  });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, hidden: result.hidden });
}
