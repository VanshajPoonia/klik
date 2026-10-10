import { after, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { releaseProofs, RELEASE_BATCH } from "@/lib/proofs";
import { recordAudit } from "@/lib/audit";
import { kickJobRunner } from "@/lib/jobs";

const schema = z.object({
  // Omitted: every one of the caller's locked proofs in the event, a batch at a time.
  mediaIds: z.array(z.string().min(1).max(64)).min(1).max(RELEASE_BATCH).optional(),
});

/**
 * MED-10: the photographer hands over the clean photos, usually once their
 * client has paid them. Only the photographer who uploaded a proof can
 * release it, whatever their role, and not the event's owner, who is usually
 * that client. A superadmin can, for a photographer who has left.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { released, more } = await releaseProofs({
    eventId: event.id,
    userId: session.user.id,
    mediaIds: parsed.data.mediaIds ?? null,
    anyPhotographer: session.user.role === "superadmin",
  });
  if (released.length > 0) {
    await recordAudit({
      actor: session,
      action: "proofs.released",
      targetType: "event",
      targetId: event.id,
      eventId: event.id,
      detail: released.length === 1 ? "1 proof" : `${released.length} proofs`,
    });
    // The grid tiles are remade from the clean photos.
    after(kickJobRunner);
  }
  return NextResponse.json({ released: released.length, ids: released, more });
}
