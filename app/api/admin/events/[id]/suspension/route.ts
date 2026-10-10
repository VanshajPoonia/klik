import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { liftSuspension, suspendEvent } from "@/lib/suspensions";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    // Emailed to the organizer, so written for them.
    reason: z.string().trim().min(10, "Write the reason the organizer will read").max(500),
    // For Klik's record only.
    note: z.string().trim().min(3, "Say why, for the record").max(300),
  }),
  z.object({ action: z.literal("lift"), note: z.string().trim().min(3, "Say why, for the record").max(300) }),
]);

/** ADM-5: pause a gallery, or reopen it. Superadmin only. See lib/suspensions.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { id } = await params;
  const input = parsed.data;

  const changed =
    input.action === "suspend"
      ? await suspendEvent(id, { byUserId: session.user.id, reason: input.reason })
      : await liftSuspension(id);
  if (!changed) {
    return NextResponse.json(
      { error: input.action === "suspend" ? "Not found, or already paused" : "Not paused" },
      { status: 409 },
    );
  }
  await recordAudit({
    actor: session,
    action: input.action === "suspend" ? "event.suspended" : "event.unsuspended",
    targetType: "event",
    targetId: id,
    eventId: id,
    detail: input.action === "suspend" ? `${input.note} Told the organizer: "${input.reason}"` : input.note,
  });
  return NextResponse.json({ ok: true });
}
