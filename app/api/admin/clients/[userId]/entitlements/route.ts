import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPlan, PLAN_KEYS } from "@/lib/plans";
import { events, users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { createVenueSlug } from "@/lib/venue";
import {
  describeActivationNotice,
  sendActivationNotice,
  sendEventLiveNotice,
} from "@/lib/activation-notice";
import { recordAccountEvent } from "@/lib/timeline";
import { grantEntitlement } from "@/lib/entitlements";

const requestSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
  // ACT-1: every grant says why. An ungoverned comp is how revenue quietly
  // disappears, and "why does this account have Premium" is a question that
  // gets asked months later by somebody who was not there.
  reason: z.string().trim().min(3, "Say why, for the record").max(300),
  // A specific event to license. Omitted, a pass goes to the account's oldest
  // waiting draft and a Venue grant to all of them it has room for.
  eventId: z.string().min(1).max(64).nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

/**
 * ACT-2: a superadmin grants a plan. This is the v1 revenue mechanism, and the
 * rule in BILLING.md stands: no payment grants anything by itself, a human does
 * it here.
 *
 * Replaces PATCH .../plan, which wrote `users.plan_key`. That put a per-event
 * product on the account, so one $39 pass meant an event every month for ever.
 * Now each grant is a ledger row: a pass licenses one event, a Venue grant
 * licenses up to its own limits, and both carry who granted them and why.
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Choose a plan and give a reason" },
      { status: 400 },
    );
  }
  const { planKey, reason, eventId, endsAt } = parsed.data;

  const { userId } = await params;
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      venueSlug: users.venueSlug,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "organizer")))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Organizer not found" }, { status: 404 });

  if (eventId) {
    const [owned] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.ownerId, userId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: "That event is not theirs" }, { status: 400 });
  }
  if (endsAt && endsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "An end date has to be in the future" }, { status: 400 });
  }

  // The reusable venue QR needs a slug, and a Venue account without one has a
  // feature it cannot use.
  if (planKey === "venue" && !account.venueSlug) {
    await db
      .update(users)
      .set({ venueSlug: createVenueSlug(account.name ?? "venue") })
      .where(eq(users.id, userId));
  }

  const actor = { id: session.user.id, label: session.user.username ?? session.user.name ?? null };
  const result = await grantEntitlement({
    userId,
    planKey,
    source: "admin",
    reason,
    grantedBy: actor,
    endsAt: endsAt ?? null,
    applyToEventId: eventId ?? null,
  });

  const plan = getPlan(planKey);
  const what = result.entitlement.scope === "event" ? `a ${plan.name} pass` : plan.name;
  const where =
    result.licensed.length > 0
      ? ` Licensed ${result.licensed.length} ${result.licensed.length === 1 ? "event" : "events"}.`
      : result.entitlement.scope === "event"
        ? " Waiting for their next event."
        : "";

  // Recorded before the email is attempted, because the grant is what happened
  // and it happened whether or not anybody could be told about it.
  await recordAccountEvent({
    userId,
    kind: result.firstActivation ? "plan_assigned" : "plan_changed",
    detail: `Granted ${what}. ${reason}.${where}`.replace("..", "."),
    actor,
  });

  const liveEvents = result.licensed.length
    ? await db
        .select({ id: events.id, name: events.name, planKey: events.planKey })
        .from(events)
        .where(inArray(events.id, result.licensed))
    : [];

  // The access email goes only on the transition into being active, never on a
  // later grant: "you are all set" arriving for someone who has been running
  // events for a month reads as a billing problem. When this grant also put a
  // waiting draft live, that email names it instead of saying "create one".
  const notice = result.firstActivation
    ? await sendActivationNotice(
        {
          id: account.id,
          name: account.name,
          email: account.email,
          username: account.username,
          planKey,
          liveEventName: liveEvents[0]?.name ?? null,
        },
        actor,
      )
    : null;

  // A later grant that put an event live says so, about that event (ACT-3).
  // Without this the organizer of a second event finds out by trying it.
  if (!result.firstActivation) {
    for (const live of liveEvents) {
      await sendEventLiveNotice(
        account,
        { id: live.id, name: live.name, planKey: live.planKey ?? planKey },
        actor,
      );
    }
  }

  return NextResponse.json(
    {
      entitlement: result.entitlement,
      licensed: result.licensed,
      refused: result.refused,
      notice: notice ? { sent: notice.sent, message: describeActivationNotice(notice) } : null,
    },
    { status: 201 },
  );
}
