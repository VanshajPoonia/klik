import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, EVENT_VISIBILITIES } from "@/lib/schema";
import { createEvent, toPublicEvent } from "@/lib/events";
import { getAccountPlan } from "@/lib/account-plans";
import { isExpired } from "@/lib/access";

const createEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
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

  return NextResponse.json({ events: rows.map(toPublicEvent) });
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

  const { name, eventDate, visibility, password, moderation, expiresAt } = parsed.data;
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

  const event = await createEvent({
    ownerId: session.user.id,
    name,
    eventDate,
    visibility,
    password,
    moderation,
    expiresAt,
  });

  return NextResponse.json({ event: toPublicEvent(event) }, { status: 201 });
}
