import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { recordAudit } from "@/lib/audit";
import { hasLegalHold } from "@/lib/reports";
import { acceptTransfer } from "@/lib/team";

/** ORG-4: the person an event was offered to takes it. Only they can. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event || event.transferToUserId !== session.user.id) {
    return NextResponse.json({ error: "There is no offer of this event to you" }, { status: 404 });
  }
  // Checked again here because a report can arrive between offer and accept.
  if (await hasLegalHold({ eventIds: [event.id] })) {
    return NextResponse.json(
      { error: "This event cannot change hands while a report on it is open. Contact Klik support." },
      { status: 409 },
    );
  }

  const result = await acceptTransfer(event.id, session.user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: "The offer is no longer open. Ask the owner to make it again." },
      { status: 409 },
    );
  }
  await recordAudit({
    actor: session,
    action: "event.transferred",
    targetType: "user",
    targetId: session.user.id,
    eventId: event.id,
    detail: "Took over the event. The previous owner stays on as a manager.",
  });
  return NextResponse.json({ ok: true });
}
