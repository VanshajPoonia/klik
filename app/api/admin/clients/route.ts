import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users, events, EVENT_VISIBILITIES } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { generateUsername, generatePassword, hashPassword } from "@/lib/credentials";
import { prepareEventInsert, toPublicEvent, type CreateEventInput } from "@/lib/events";

const createClientSchema = z.object({
  contactName: z.string().trim().min(1).max(120),
  eventName: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  moderation: z.boolean().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  galleryPassword: z.string().min(4).max(72).optional(),
});

export async function GET() {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      eventId: events.id,
      eventName: events.name,
      eventSlug: events.slug,
      visibility: events.visibility,
      expiresAt: events.expiresAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(users, eq(events.ownerId, users.id))
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
  eventInput: Omit<CreateEventInput, "ownerId">,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const userId = nanoid();
    const username = generateUsername(contactName);
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const userQuery = db
      .insert(users)
      .values({ id: userId, name: contactName, role: "organizer", username, passwordHash })
      .returning();
    const { query: eventQuery } = await prepareEventInsert({ ownerId: userId, ...eventInput });

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
  } = parsed.data;

  if (visibility === "password" && !galleryPassword) {
    return NextResponse.json(
      { error: "Gallery password required for password-protected events" },
      { status: 400 },
    );
  }

  const { user, event, password } = await createOrganizerUserAndEvent(contactName, {
    name: eventName,
    eventDate,
    expiresAt,
    moderation,
    visibility,
    password: galleryPassword,
  });

  return NextResponse.json(
    {
      username: user.username,
      password, // shown once here - never retrievable again after this response
      event: toPublicEvent(event),
    },
    { status: 201 },
  );
}
