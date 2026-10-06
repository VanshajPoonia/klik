import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPlan, PLAN_KEYS } from "@/lib/plans";
import { events, users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { isEventActive } from "@/lib/access";
import { wasCreatedThisUtcMonth } from "@/lib/plan-limits";
import { createVenueSlug } from "@/lib/venue";
import { describeActivationNotice, sendActivationNotice } from "@/lib/activation-notice";

const requestSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid plan" }, { status: 400 });
  }

  const { userId } = await params;
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      venueSlug: users.venueSlug,
      email: users.email,
      username: users.username,
      // Read before the update, because the update itself destroys the one fact
      // that decides whether to send: whether this account was already active.
      // COALESCE below means the column looks the same afterwards either way.
      activatedAt: users.activatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "organizer")))
    .limit(1);
  if (!account) {
    return NextResponse.json({ error: "Organizer not found" }, { status: 404 });
  }

  const plan = getPlan(parsed.data.planKey);
  const organizerEvents = await db
    .select({
      isActive: events.isActive,
      expiresAt: events.expiresAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(eq(events.ownerId, userId), isNull(events.deletedAt)));
  const activeEventCount = organizerEvents.filter((event) => isEventActive(event)).length;
  const monthlyEventCount = organizerEvents.filter((event) =>
    wasCreatedThisUtcMonth(event.createdAt),
  ).length;
  if (activeEventCount > plan.maxActiveEvents) {
    const eventsToClose = activeEventCount - plan.maxActiveEvents;
    return NextResponse.json(
      {
        error: `Close or delete ${eventsToClose} active ${
          eventsToClose === 1 ? "event" : "events"
        } before assigning ${plan.name}.`,
      },
      { status: 409 },
    );
  }
  if (monthlyEventCount > plan.maxEventsPerMonth) {
    return NextResponse.json(
      {
        error: `${plan.name} allows ${plan.maxEventsPerMonth} ${
          plan.maxEventsPerMonth === 1 ? "event" : "events"
        } per month, but this organizer has already created ${monthlyEventCount}. Assign this plan after the monthly allowance resets.`,
      },
      { status: 409 },
    );
  }

  let updatedAccount;
  try {
    [updatedAccount] = await db
      .update(users)
      .set({
        planKey: parsed.data.planKey,
        venueSlug:
          parsed.data.planKey === "venue"
            ? account.venueSlug ?? createVenueSlug(account.name ?? "venue")
            : account.venueSlug,
        // Assigning a plan IS the activation. Making it a second control would
        // mean a plan granted and access still refused, which looks from the
        // dashboard exactly like a payment that never landed, and the person who
        // forgot the second click is not the person who waits.
        //
        // COALESCE, so re-assigning a plan later does not move the date. When
        // this account first became entitled is a fact about the past.
        activatedAt: sql`COALESCE(${users.activatedAt}, now())`,
      })
      .where(and(eq(users.id, userId), eq(users.role, "organizer")))
      .returning({ id: users.id, planKey: users.planKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("plan_active_limit") || message.includes("plan_monthly_limit")) {
      return NextResponse.json(
        { error: "The organizer's current events no longer fit this plan. Refresh and try again." },
        { status: 409 },
      );
    }
    throw error;
  }

  // Retention only ever moves outward. An upgrade should genuinely extend how
  // long a gallery survives, but a downgrade must not retroactively shorten a
  // window the organizer already had, because the next purge run would then
  // permanently delete media that was safe when they woke up this morning.
  // GREATEST() keeps whichever deadline is further away, including for rows
  // predating this column. See ROADMAP.md SEC-1.
  await db
    .update(events)
    .set({
      retentionUntil: sql`GREATEST(
        COALESCE(${events.retentionUntil}, ${events.createdAt}),
        ${events.createdAt} + (${plan.galleryAccessDays}::int * interval '1 day')
      )`,
      updatedAt: new Date(),
    })
    .where(and(eq(events.ownerId, userId), isNull(events.deletedAt)));

  // Only on the transition into being active, never on a later plan change.
  // Re-sending "you are all set" to somebody who has been running events for a
  // month because their plan was corrected reads as a billing problem. The
  // resend control on /admin covers every deliberate repeat.
  const justActivated = !account.activatedAt;
  const notice = justActivated
    ? await sendActivationNotice({
        id: account.id,
        name: account.name,
        email: account.email,
        username: account.username,
        planKey: parsed.data.planKey,
      })
    : null;

  // The send result travels back with the response rather than being logged and
  // forgotten. The superadmin who clicked is the only person who can act on a
  // failure, and they are looking at the screen right now.
  return NextResponse.json({
    account: updatedAccount,
    notice: notice
      ? { sent: notice.sent, message: describeActivationNotice(notice) }
      : null,
  });
}
