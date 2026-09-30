import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { toOrganizerEvent } from "@/lib/events";

/**
 * Restores a soft-deleted event within its 30-day window.
 *
 * Separate from the per-event trash route because that one requires a live
 * event to operate on, and this is the case where the event itself is the
 * thing in the bin.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Deliberately reads without the usual isNull(deletedAt) filter: a deleted
  // event is exactly what this route exists to find.
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNotNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Uploads stay off after a restore. Re-opening a gallery to guests is a
  // decision the organizer should make deliberately, not a side effect of
  // undoing a delete.
  const [restored] = await db
    .update(events)
    .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
    .where(and(eq(events.id, id), isNotNull(events.deletedAt)))
    .returning();
  if (!restored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ event: toOrganizerEvent(restored) });
}
