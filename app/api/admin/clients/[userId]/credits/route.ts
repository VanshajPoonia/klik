import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/roles";
import { spendCredit } from "@/lib/referrals";
import { recordAudit } from "@/lib/audit";

const schema = z.object({
  amountCents: z.number().int().positive().max(100000),
  reason: z.string().trim().min(3, "Say what it was used for.").max(300),
});

/**
 * GRW-5: a superadmin uses some of an account's credit, typically by refunding
 * that much of a payment in Stripe first. Recorded here with the reason, so
 * the ledger and the account's own page agree with what was done.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const actor = { id: session.user.id, label: session.user.username ?? session.user.name ?? null };
  const result = await spendCredit({ userId, amountCents: parsed.data.amountCents, reason: parsed.data.reason, by: actor });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await recordAudit({
    actor: session,
    action: "credit.used",
    targetType: "user",
    targetId: userId,
    detail: `${parsed.data.amountCents} cents. ${parsed.data.reason}`,
  });
  return NextResponse.json({ balanceCents: result.balanceCents });
}
