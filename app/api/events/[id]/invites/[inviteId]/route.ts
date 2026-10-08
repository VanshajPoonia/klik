import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { recordAudit } from "@/lib/audit";
import { requireEventCapability } from "@/lib/roles";
import { revokeInvite } from "@/lib/team";

/** ORG-3: withdraws an invitation that has not been accepted yet. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const { id, inviteId } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const actor = await requireEventCapability(event.id, event.ownerId, "cohosts.manage");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await revokeInvite(inviteId, event.id))) {
    return NextResponse.json({ error: "That invitation has already been used or withdrawn" }, { status: 409 });
  }
  await recordAudit({
    actor: actor.session,
    action: "team.changed",
    targetType: "event",
    targetId: event.id,
    eventId: event.id,
    detail: "Withdrew an invitation.",
  });
  return NextResponse.json({ ok: true });
}
