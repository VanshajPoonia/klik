import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users, events, EVENT_VISIBILITIES } from "@/lib/schema";
import { PLAN_KEYS, getPlan, type PlanKey } from "@/lib/plans";
import { requireSuperadmin } from "@/lib/roles";
import { generateUsername, generatePassword, hashPassword } from "@/lib/credentials";
import { prepareEventInsert, toPublicEvent, type CreateEventInput } from "@/lib/events";
import { createVenueSlug } from "@/lib/venue";

const createClientSchema = z.object({
  contactName: z.string().trim().min(1).max(120),
  eventName: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  moderation: z.boolean().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  galleryPassword: z.string().min(4).max(72).optional(),
  planKey: z.enum(PLAN_KEYS).default("event"),
});

export async function GET() {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      planKey: users.planKey,
      eventId: events.id,
      eventName: events.name,
      eventSlug: events.slug,
      visibility: events.visibility,
      expiresAt: events.expiresAt,
      createdAt: events.createdAt,
    })
    .from(users)
    .leftJoin(events, eq(events.ownerId, users.id))
    .where(eq(users.role, "organizer"))
    .orderBy(desc(events.createdAt));

  return NextResponse.json({ clients: rows });
}

/**
 * Creates the venue's login (users row) and their event together, atomically.
 * neon-http has no db.transaction() support - only db.batch() - so both
 * inserts are built (not executed) and submitted as one batch, retried only
 * on a username collision (~1-in-a-million per attempt).
 */
async function createOrganizerUserAndEvent(
  contactName: string,
  planKey: PlanKey,
  eventInput: Omit<CreateEventInput, "ownerId">,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const userId = nanoid();
    const username = generateUsername(contactName);
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const userQuery = db
      .insert(users)
      .values({
        id: userId,
        name: contactName,
        role: "organizer",
        planKey,
        venueSlug: planKey === "venue" ? createVenueSlug(contactName) : null,
        username,
        passwordHash,
        // Activated on creation. Reaching this route means a superadmin has
        // already made the decision that `activated_at` records, and the event
        // is being created in the same batch, so an inactive account here would
        // be an account that cannot touch the event it was just given.
        activatedAt: new Date(),
      })
      .returning();
    const { query: eventQuery } = await prepareEventInsert({
      ownerId: userId,
      ...eventInput,
      retentionDays: getPlan(planKey).galleryAccessDays,
    });

    try {
      const [[user], [event]] = await db.batch([userQuery, eventQuery]);
      return { user, event, password };
    } catch (error) {
      const isUniqueViolation = (error as { code?: string })?.code === "23505";
      if (!isUniqueViolation || attempt === 4) throw error;
    }
  }
  throw new Error("Could not generate a unique username");
}

export async function POST(request: Request) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const {
    contactName,
    eventName,
    eventDate,
    expiresAt,
    moderation,
    visibility,
    galleryPassword,
    planKey,
  } = parsed.data;

  if (visibility === "password" && !galleryPassword) {
    return NextResponse.json(
      { error: "Gallery password required for password-protected events" },
      { status: 400 },
    );
  }

  const { user, event, password } = await createOrganizerUserAndEvent(
    contactName,
    planKey,
    {
      name: eventName,
      eventDate,
      expiresAt,
      moderation,
      visibility,
      password: galleryPassword,
    },
  );

  return NextResponse.json(
    {
      username: user.username,
      password, // shown once here, never retrievable again after this response
      event: toPublicEvent(event),
    },
    { status: 201 },
  );
}
