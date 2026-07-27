import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPlan, PLAN_KEYS } from "@/lib/plans";
import { events, users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { isEventActive } from "@/lib/access";
import { wasCreatedThisUtcMonth } from "@/lib/plan-limits";
import { createVenueSlug } from "@/lib/venue";

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
    .select({ id: users.id, name: users.name, venueSlug: users.venueSlug })
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
    .where(eq(events.ownerId, userId));
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

  return NextResponse.json({ account: updatedAccount });
}
