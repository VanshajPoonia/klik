import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { licenseWithAvailableGrant } from "@/lib/entitlements";
import { eventLicenseState } from "@/lib/license";
import { getPlan } from "@/lib/plans";
import { recordAccountEvent } from "@/lib/timeline";

/**
 * ACT-3: the organizer puts a draft live with what their account already holds,
 * a Venue grant with room or an unused pass. No human involved, because the
 * human decision already happened when the pass was granted.
 *
 * Also how a lapsed event comes back, once the account has something new.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (eventLicenseState(event) === "live") {
    return NextResponse.json({ error: "This event is already live." }, { status: 409 });
  }

  const result = await licenseWithAvailableGrant(event);
  if (!result.licensed) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  await recordAccountEvent({
    userId: event.ownerId,
    kind: "event_went_live",
    detail: `Put "${event.name}" live on ${getPlan(result.planKey).name}.`,
    actor: { id: session.user.id, label: session.user.username ?? session.user.name ?? null },
  });
  return NextResponse.json({ ok: true, planKey: result.planKey });
}
