import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, venueClients, EVENT_VISIBILITIES } from "@/lib/schema";
import { createEvent, toOrganizerEvent } from "@/lib/events";
import { getAccountPlan, isAccountActivated } from "@/lib/account-plans";
import { isEventActive } from "@/lib/access";
import { canManageEventClients } from "@/lib/plans";
import { wasCreatedThisUtcMonth } from "@/lib/plan-limits";
import { SUPPORT_PHONE } from "@/lib/support";

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  clientPhone: z.string().trim().max(40).optional(),
  clientId: z.string().min(10).max(64).nullable().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  password: z.string().min(4).max(72).optional(),
  moderation: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.ownerId, session.user.id), isNull(events.deletedAt)))
    .orderBy(events.createdAt);

  return NextResponse.json({ events: rows.map(toOrganizerEvent) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const {
    name,
    eventDate,
    clientName,
    clientEmail,
    clientPhone,
    clientId,
    visibility,
    password,
    moderation,
    expiresAt,
  } = parsed.data;
  if (visibility === "password" && !password) {
    return NextResponse.json(
      { error: "Password required for password-protected events" },
      { status: 400 },
    );
  }

  const [plan, activated, existingEvents] = await Promise.all([
    getAccountPlan(session.user.id),
    isAccountActivated(session.user.id),
    db
      .select({
        isActive: events.isActive,
        expiresAt: events.expiresAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(eq(events.ownerId, session.user.id), isNull(events.deletedAt))),
  ]);
  // Checked before the plan limits, because an account that signed itself up
  // has a plan it was never granted: `users.plan_key` defaults to 'event', so
  // the limit checks below would happily let it create the $39 product. This is
  // the only thing standing between the public signup form and free access.
  if (!activated) {
    return NextResponse.json(
      {
        error:
          "Your account is not active yet. Choose a plan and complete payment, and the Klik team will activate it. Call or text " +
          `${SUPPORT_PHONE} if you have already paid.`,
      },
      { status: 403 },
    );
  }

  const activeEventCount = existingEvents.filter((event) => isEventActive(event)).length;
  const monthlyEventCount = existingEvents.filter((event) =>
    wasCreatedThisUtcMonth(event.createdAt),
  ).length;
  if (activeEventCount >= plan.maxActiveEvents) {
    return NextResponse.json(
      {
        error: `${plan.name} supports ${plan.maxActiveEvents} active ${
          plan.maxActiveEvents === 1 ? "event" : "events"
        }. Ask an administrator to change your plan or wait for an event to end.`,
      },
      { status: 403 },
    );
  }
  if (monthlyEventCount >= plan.maxEventsPerMonth) {
    return NextResponse.json(
      {
        error: `${plan.name} supports ${plan.maxEventsPerMonth} new ${
          plan.maxEventsPerMonth === 1 ? "event" : "events"
        } per calendar month. Your monthly allowance resets on the first day of the next UTC month.`,
      },
      { status: 403 },
    );
  }

  const hasClientDetails = Boolean(clientId || clientName || clientEmail || clientPhone);
  if (hasClientDetails && !canManageEventClients(plan.key)) {
    return NextResponse.json(
      { error: "Client details are available on the Klik Venue plan" },
      { status: 403 },
    );
  }
  let selectedClient:
    | { id: string; name: string; email: string | null; phone: string | null }
    | undefined;
  if (clientId) {
    [selectedClient] = await db
      .select({
        id: venueClients.id,
        name: venueClients.name,
        email: venueClients.email,
        phone: venueClients.phone,
      })
      .from(venueClients)
      .where(
        and(
          eq(venueClients.id, clientId),
          eq(venueClients.ownerId, session.user.id),
          isNull(venueClients.deletedAt),
        ),
      )
      .limit(1);
    if (!selectedClient) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  }

  let event;
  try {
    event = await createEvent({
      ownerId: session.user.id,
      name,
      eventDate,
      clientId: selectedClient?.id ?? null,
      clientName: selectedClient?.name ?? clientName ?? null,
      clientEmail: selectedClient?.email ?? clientEmail ?? null,
      clientPhone: selectedClient?.phone ?? clientPhone ?? null,
      visibility,
      password,
      moderation,
      expiresAt,
      retentionDays: plan.galleryAccessDays,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("event_active_limit") || message.includes("event_monthly_limit")) {
      return NextResponse.json(
        { error: "Your plan limit was reached while this event was being created. Refresh and try again." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ event: toOrganizerEvent(event) }, { status: 201 });
}
