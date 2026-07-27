import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventCoHosts, events } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db
    .delete(eventCoHosts)
    .where(and(eq(eventCoHosts.eventId, id), eq(eventCoHosts.userId, userId)));
  return NextResponse.json({ ok: true });
}
