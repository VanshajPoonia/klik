import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { revokeKiosk } from "@/lib/kiosks";
import { recordAudit } from "@/lib/audit";

/**
 * VEN-2: switches a kiosk off. Its tablet is shut out at its next request, and
 * the photos it took stay in the gallery. There is no switching back on: a
 * tablet that went missing should not come back to life, so a new kiosk is a
 * new pairing.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; kioskId: string }> }) {
  const { id, kioskId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "event.settings");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kiosk = await revokeKiosk(id, kioskId);
  if (!kiosk) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({
    actor: actor.session,
    action: "kiosk.revoked",
    targetType: "kiosk",
    targetId: kiosk.id,
    eventId: id,
    detail: kiosk.name,
  });
  return NextResponse.json({ ok: true });
}
