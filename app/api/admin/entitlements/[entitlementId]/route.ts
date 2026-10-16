import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { entitlements } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { recordAudit } from "@/lib/audit";
import { recordAccountEvent } from "@/lib/timeline";
import { getPlan } from "@/lib/plans";

const requestSchema = z.object({
  /** When the plan stops, or null for no end. A date in the past is a revocation, which has its own route. */
  endsAt: z.coerce.date().nullable(),
  reason: z.string().trim().min(3, "Say why, for the record").max(300),
});

/**
 * A Venue plan's end date: renewed for three more months, paid for a year,
 * cancelled from the end of this period. Nothing is charged; Stripe took the
 * money, and this records what it bought.
 *
 * Only for an account grant that is active and not in a failed payment's
 * grace, because the grace owns the end date while it runs (PAY-8) and
 * "Payment received" is how that one ends. A pass has no end date.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ entitlementId: string }> }) {
  const session = await requireSuperadmin();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { endsAt, reason } = parsed.data;
  if (endsAt && endsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Pick a date in the future, or revoke the plan to end it now." }, { status: 400 });
  }

  const { entitlementId } = await params;
  const [grant] = await db.select().from(entitlements).where(eq(entitlements.id, entitlementId)).limit(1);
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (grant.scope !== "account") {
    return NextResponse.json({ error: "A pass has no end date." }, { status: 400 });
  }
  if (grant.status !== "active") {
    return NextResponse.json({ error: "This plan has been revoked. Grant a new one instead." }, { status: 409 });
  }
  if (grant.graceStartedAt) {
    return NextResponse.json(
      { error: "A failed payment's grace is running. Press Payment received first." },
      { status: 409 },
    );
  }

  await db.update(entitlements).set({ endsAt }).where(eq(entitlements.id, entitlementId));

  const day = (date: Date | null) =>
    date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no end date";
  const detail = `${getPlan(grant.planKey).name} now ends ${endsAt ? `on ${day(endsAt)}` : "never"}, was ${day(grant.endsAt)}. ${reason}.`.replace(
    "..",
    ".",
  );
  const actor = { id: session.user.id, label: session.user.username ?? session.user.name ?? null };
  await recordAccountEvent({ userId: grant.userId, kind: "plan_changed", detail, actor });
  await recordAudit({ actor: session, action: "plan.end_changed", targetType: "entitlement", targetId: grant.id, detail });

  return NextResponse.json({ ok: true, endsAt: endsAt?.toISOString() ?? null });
}
