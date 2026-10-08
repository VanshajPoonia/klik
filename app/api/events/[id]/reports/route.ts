import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { resolveReports } from "@/lib/reports";

const requestSchema = z.object({
  mediaId: z.string().min(1).max(64),
  resolution: z.enum(["dismissed", "removed"]),
});

/**
 * The organizer closes the reports on one photo: "dismissed" after looking and
 * deciding it stays, "removed" after deleting or hiding it. Either way the
 * reporters' reports are answered rather than left open for ever.
 *
 * A photo under a legal hold is not theirs to resolve. That is Klik's, on
 * /admin, because it may be evidence.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.moderate");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const [item] = await db
    .select({ legalHoldAt: media.legalHoldAt })
    .from(media)
    .where(and(eq(media.id, parsed.data.mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.legalHoldAt) {
    return NextResponse.json(
      { error: "The Klik team is handling this one. It stays hidden until they have." },
      { status: 403 },
    );
  }

  const closed = await resolveReports(parsed.data.mediaId, {
    byUserId: actor.session.user.id,
    resolution: parsed.data.resolution === "dismissed" ? "Reviewed by the host and kept" : "Removed by the host",
  });
  return NextResponse.json({ ok: true, closed });
}
