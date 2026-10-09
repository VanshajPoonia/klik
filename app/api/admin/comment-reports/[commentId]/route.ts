import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/roles";
import { adminResolveComment } from "@/lib/comments";
import { log } from "@/lib/observability";

const requestSchema = z.object({
  action: z.enum(["keep", "hide", "delete"]),
  note: z.string().trim().min(3, "Say what you found, for the record").max(300),
});

/**
 * ADM-5, for comments (MED-9). Klik's side of the queue:
 *
 * - `keep`: it is fine. Reports are closed and, if reports hid it, it comes
 *   back. A host who hid it themselves keeps it hidden.
 * - `hide`: hidden as Klik, which the host cannot undo.
 * - `delete`: gone, reports with it. The audit line is the record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { commentId } = await params;
  const { action, note } = parsed.data;
  const result = await adminResolveComment(commentId, { action, byUserId: session.user.id, note });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  log.info("comment_reports.admin_action", { commentId, action });
  await recordAudit({
    actor: session,
    action: "report.resolved",
    targetType: "comment",
    targetId: commentId,
    eventId: result.eventId,
    detail: `${action}. ${note}`,
  });
  return NextResponse.json({ ok: true });
}
