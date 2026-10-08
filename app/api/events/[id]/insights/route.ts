import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventManagerSession } from "@/lib/roles";
import { eventInsights } from "@/lib/insights";

/** GRW-7: the insights tab's numbers, for anyone on the event's team. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db
    .select({ id: events.id, ownerId: events.ownerId })
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireEventManagerSession(event.id, event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await eventInsights(event.id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
