import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, users } from "@/lib/schema";
import { recordAudit } from "@/lib/audit";
import { hasLegalHold } from "@/lib/reports";
import { requireOwnerSession } from "@/lib/roles";
import { cancelTransfer, emailTransferOffered, offerTransfer } from "@/lib/team";

/**
 * ORG-4: handing an event to somebody else.
 *
 * POST offers it to a manager on the team. Nothing moves until they accept, at
 * /transfer/accept, so an owner who picks the wrong person loses nothing.
 * DELETE withdraws the offer, and is open to both ends of it: the owner changing
 * their mind, or the recipient saying no.
 */

const offerSchema = z.object({ toUserId: z.string().min(1).max(64) });

async function loadEvent(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  return event ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Only the event's owner can hand it over" }, { status: 401 });

  const parsed = offerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose who to hand the event to" }, { status: 400 });
  const { toUserId } = parsed.data;
  if (toUserId === event.ownerId) {
    return NextResponse.json({ error: "That account already owns the event" }, { status: 409 });
  }

  // TRS-1: a photo under a legal hold is evidence. Who answers for the event
  // it came from does not change while that is open.
  if (await hasLegalHold({ eventIds: [event.id] })) {
    return NextResponse.json(
      { error: "This event cannot change hands while a report on it is open. Contact Klik support." },
      { status: 409 },
    );
  }

  if (!(await offerTransfer(event.id, toUserId))) {
    return NextResponse.json(
      { error: "An event can only be handed to a manager on its team. Add them as a manager first." },
      { status: 409 },
    );
  }
  const [recipient] = await db
    .select({ email: users.email, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, toUserId))
    .limit(1);
  await emailTransferOffered(recipient?.email ?? null, event.id, event.name);
  await recordAudit({
    actor: session,
    action: "event.transfer_offered",
    targetType: "user",
    targetId: toUserId,
    eventId: event.id,
    detail: `Offered to ${recipient?.name ?? recipient?.username ?? "a manager"}.`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.transferToUserId) return NextResponse.json({ ok: true });

  const session = await auth();
  const isRecipient = session?.user?.id === event.transferToUserId;
  const ownerSession = isRecipient ? null : await requireOwnerSession(event.ownerId);
  if (!isRecipient && !ownerSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await cancelTransfer(event.id, event.transferToUserId);
  await recordAudit({
    actor: session,
    action: "event.transfer_withdrawn",
    targetType: "user",
    targetId: event.transferToUserId,
    eventId: event.id,
    detail: isRecipient ? "Declined by the recipient." : "Withdrawn by the owner.",
  });
  return NextResponse.json({ ok: true });
}
