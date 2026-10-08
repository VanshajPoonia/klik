import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { entitlements } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { recordAccountEvent } from "@/lib/timeline";
import { revokeEntitlement } from "@/lib/entitlements";
import { getPlan } from "@/lib/plans";

const requestSchema = z.object({
  reason: z.string().trim().min(3, "Say why, for the record").max(300),
});

/**
 * Takes a grant back: a refund, a chargeback, a comp that has run its course.
 *
 * What it does not do is delete anything. The events it licensed lapse, which
 * means no new uploads while every guest can still see the gallery for the rest
 * of its window, because guests did nothing wrong (ROADMAP.md C-6). The grant
 * row stays, marked revoked with who and why, so the history survives.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ entitlementId: string }> },
) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Give a reason" }, { status: 400 });
  }

  const { entitlementId } = await params;
  const [grant] = await db.select().from(entitlements).where(eq(entitlements.id, entitlementId)).limit(1);
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await revokeEntitlement(entitlementId, {
    by: { id: session.user.id },
    reason: parsed.data.reason,
  });
  if (!result.revoked) {
    return NextResponse.json({ error: "Already revoked" }, { status: 409 });
  }

  await recordAccountEvent({
    userId: grant.userId,
    kind: "plan_revoked",
    detail: `Revoked ${getPlan(grant.planKey).name}${grant.scope === "event" ? " pass" : ""}. ${parsed.data.reason}.${
      result.lapsedEvents ? ` ${result.lapsedEvents} ${result.lapsedEvents === 1 ? "event" : "events"} stopped taking uploads.` : ""
    }`.replace("..", "."),
    actor: { id: session.user.id, label: session.user.username ?? session.user.name ?? null },
  });

  await recordAudit({
    actor: session,
    action: "plan.revoked",
    targetType: "entitlement",
    targetId: entitlementId,
    detail: `${parsed.data.reason}. ${result.lapsedEvents} events lapsed.`,
  });
  return NextResponse.json({ ok: true, lapsedEvents: result.lapsedEvents });
}
