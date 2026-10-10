import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/roles";
import { clearGrace, startGrace } from "@/lib/billing-grace";
import { recordAudit } from "@/lib/audit";
import { kickJobRunner } from "@/lib/jobs";

const schema = z.object({ action: z.enum(["start", "clear"]) });

/**
 * PAY-8: a superadmin starts a failed payment's 7-day grace on a Venue grant,
 * or clears it when the payment comes in. Nothing here charges or refunds.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperadmin();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const actor = { id: session.user.id, label: session.user.username ?? session.user.name ?? null };
  const outcome = parsed.data.action === "start" ? await startGrace(id, actor) : await clearGrace(id, actor);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  await recordAudit({
    actor: session,
    action: parsed.data.action === "start" ? "plan.grace_started" : "plan.grace_cleared",
    targetType: "entitlement",
    targetId: id,
  });
  // The first email goes now, not at tomorrow's cron.
  if (parsed.data.action === "start") after(kickJobRunner);
  return NextResponse.json({ ok: true, endsAt: outcome.endsAt?.toISOString() ?? null });
}
