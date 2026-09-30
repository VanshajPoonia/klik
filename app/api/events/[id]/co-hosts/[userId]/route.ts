import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventCoHosts, events } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Soft delete, so a removal made in error can be undone. Access is revoked
  // the instant this lands, because requireEventManagerSession filters on
  // deleted_at and that is the only query that grants co-host access.
  await db
    .update(eventCoHosts)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(eventCoHosts.eventId, id),
        eq(eventCoHosts.userId, userId),
        isNull(eventCoHosts.deletedAt),
      ),
    );
  return NextResponse.json({ ok: true });
}
