import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, EVENT_VISIBILITIES } from "@/lib/schema";
import { createEvent, toOrganizerEvent } from "@/lib/events";
import { getAccountPlan } from "@/lib/account-plans";
import { isExpired } from "@/lib/access";
import { canManageEventClients } from "@/lib/plans";
import { wasCreatedThisUtcMonth } from "@/lib/plan-limits";

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
  clientName: z.string().trim().max(120).optional(),
  clientEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  clientPhone: z.string().trim().max(40).optional(),
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
    .where(eq(events.ownerId, session.user.id))
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

  const [plan, existingEvents] = await Promise.all([
    getAccountPlan(session.user.id),
    db
      .select({
        expiresAt: events.expiresAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(eq(events.ownerId, session.user.id)),
  ]);
  const activeEventCount = existingEvents.filter(
    (event) => !isExpired(event, plan.galleryAccessDays),
  ).length;
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

  const hasClientDetails = Boolean(clientName || clientEmail || clientPhone);
  if (hasClientDetails && !canManageEventClients(plan.key)) {
    return NextResponse.json(
      { error: "Client details are available on the Klik Venue plan" },
      { status: 403 },
    );
  }

  const event = await createEvent({
    ownerId: session.user.id,
    name,
    eventDate,
    clientName: clientName || null,
    clientEmail: clientEmail || null,
    clientPhone: clientPhone || null,
    visibility,
    password,
    moderation,
    expiresAt,
  });

  return NextResponse.json({ event: toOrganizerEvent(event) }, { status: 201 });
}
