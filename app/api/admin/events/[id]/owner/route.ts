import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/roles";
import { findAccount, moveEvent, recordMove } from "@/lib/admin-events";
import { recordAudit } from "@/lib/audit";

/**
 * ADM-7: a superadmin moves an event to another account. The licence goes with
 * it, as with ORG-4's handover; see moveEvent.
 */

const schema = z.object({
  /** An email, an @handle, or an account id. */
  to: z.string().trim().min(1).max(254),
  keepPreviousOwner: z.boolean().default(true),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say who it goes to" }, { status: 400 });

  const target = await findAccount(parsed.data.to);
  if (!target) {
    return NextResponse.json({ error: "No account has that email or handle. Create it on New client first." }, { status: 404 });
  }

  const moved = await moveEvent({ eventId: id, toUserId: target.id, keepPreviousOwner: parsed.data.keepPreviousOwner });
  if (!moved.ok) {
    const error =
      moved.reason === "not_found"
        ? "That event is gone or in the trash"
        : moved.reason === "same_owner"
          ? "It already belongs to that account"
          : "Someone changed this event a moment ago. Refresh and try again.";
    return NextResponse.json({ error }, { status: moved.reason === "not_found" ? 404 : 409 });
  }

  const label = session.user.username ?? session.user.name ?? null;
  await recordAudit({
    actor: session,
    action: "event.transferred",
    targetType: "event",
    targetId: id,
    eventId: id,
    detail: `Moved by Klik to ${target.email ?? (target.username ? `@${target.username}` : target.id)}${parsed.data.keepPreviousOwner ? ", previous owner kept as a manager" : ""}.`,
  });
  after(() =>
    recordMove({
      eventId: id,
      eventName: moved.eventName,
      fromUserId: moved.previousOwnerId,
      toUserId: target.id,
      by: session.user.id ? { id: session.user.id, label } : null,
    }),
  );
  return NextResponse.json({ ok: true, ownerId: target.id });
}
