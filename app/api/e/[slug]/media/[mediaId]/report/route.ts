import { NextResponse } from "next/server";
import { z } from "zod";
import { REPORT_REASONS } from "@/lib/schema";
import { resolveVisibleMedia } from "@/lib/media-viewer";
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

  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await fileReport({
    eventId: found.event.id,
    mediaId: found.item.id,
    reason: parsed.data.reason,
    note: parsed.data.note,
    reporter: {
      guestId: found.guestId,
      userId: found.managerUserId,
      ip: clientIp(request),
    },
  });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, hidden: result.hidden });
}
