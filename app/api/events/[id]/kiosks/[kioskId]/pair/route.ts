import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseKiosk } from "@/lib/plans";
import { renewPairCode } from "@/lib/kiosks";
import { getAppUrl } from "@/lib/env";

/** VEN-2: a new pairing link for a kiosk, for a tablet that was reset or swapped. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; kioskId: string }> }) {
  const { id, kioskId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "event.settings");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseKiosk(eventPlan(event).key)) {
    return NextResponse.json({ error: "Kiosk mode is part of Klik Premium and Klik Venue" }, { status: 403 });
  }

  const code = await renewPairCode(id, kioskId);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ pairUrl: `${getAppUrl()}/k/${code}` });
}
