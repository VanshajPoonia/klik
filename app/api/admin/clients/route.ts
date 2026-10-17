import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { recordAccountEvent } from "@/lib/timeline";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users, events, EVENT_VISIBILITIES } from "@/lib/schema";
import { PLAN_KEYS, type PlanKey } from "@/lib/plans";
import { grantEntitlement } from "@/lib/entitlements";
import { requireSuperadmin } from "@/lib/roles";
import { generateUsername, generatePassword, hashPassword } from "@/lib/credentials";
import { prepareEventInsert, toPublicEvent, type CreateEventInput } from "@/lib/events";
import { createVenueSlug } from "@/lib/venue";
import { isUniqueViolation, raisedBy } from "@/lib/db-errors";
import { fieldsForTemplate, resolveTemplateChoice } from "@/lib/gallery-templates";
import { templateChoiceSchema, templateFieldsSchema } from "@/lib/template-fields";

const createClientSchema = z.object({
  contactName: z.string().trim().min(1).max(120),
  // ADM-7: where their access email and receipts go. Optional, as before.
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  // ADM-7: false makes the login alone, with no event and no plan yet.
  withEvent: z.boolean().default(true),
  eventName: z.string().trim().min(1).max(120).optional(),
  eventDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  moderation: z.boolean().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  galleryPassword: z.string().min(4).max(72).optional(),
  planKey: z.enum(PLAN_KEYS).default("event"),
  // TPL-1: the look, its colourway and the host's words, as on New event.
  template: templateChoiceSchema.optional(),
  colorway: z.string().max(40).optional(),
  templateFields: templateFieldsSchema.optional(),
});

export async function GET() {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      planKey: events.planKey,
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
  email: string | null,
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
        email,
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
    // A draft in the batch, licensed by the grant below. The grant is what sets
    // retention now, from the moment the event goes live.
    const { query: eventQuery } = await prepareEventInsert({
      ownerId: userId,
      ...eventInput,
      retentionDays: null,
    });

    try {
      const [[user], [event]] = await db.batch([userQuery, eventQuery]);
      return { user, event, password };
    } catch (error) {
      const uniqueViolation = isUniqueViolation(error) || raisedBy(error, "username_reserved");
      if (!uniqueViolation || attempt === 4) throw error;
    }
  }
  throw new Error("Could not generate a unique username");
}

/**
 * ADM-7: a login and nothing else. Not activated and holding no plan, so it
 * waits in "Signed up, not activated" like a signup would, and is granted from
 * its page when there is something to grant.
 */
async function createOrganizerUserOnly(contactName: string, email: string | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const password = generatePassword();
    try {
      const [user] = await db
        .insert(users)
        .values({
          id: nanoid(),
          name: contactName,
          email,
          role: "organizer",
          username: generateUsername(contactName),
          passwordHash: await hashPassword(password),
          activatedAt: null,
          organizerIntentAt: new Date(),
        })
        .returning();
      return { user, password };
    } catch (error) {
      const uniqueViolation = isUniqueViolation(error) || raisedBy(error, "username_reserved");
      if (!uniqueViolation || attempt === 4) throw error;
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
  const choice = parsed.data.template ? resolveTemplateChoice(parsed.data.template, parsed.data.colorway) : null;
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : null;
  if (email) {
    const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (taken) {
      return NextResponse.json({ error: "There is already an account with that email. Find it on Search." }, { status: 409 });
    }
  }

  if (!parsed.data.withEvent) {
    const { user, password } = await createOrganizerUserOnly(contactName, email);
    await recordAccountEvent({
      userId: user.id,
      kind: "account_created",
      detail: "Created by Klik at /admin/new, without an event.",
      actor: session.user.id ? { id: session.user.id, label: session.user.username ?? session.user.name ?? null } : null,
    });
    return NextResponse.json({ username: user.username, password, userId: user.id, event: null }, { status: 201 });
  }
  if (!eventName) {
    return NextResponse.json({ error: "Name the event, or untick \"Set up their first event\"" }, { status: 400 });
  }

  if (visibility === "password" && !galleryPassword) {
    return NextResponse.json(
      { error: "Gallery password required for password-protected events" },
      { status: 400 },
    );
  }

  const { user, event: draft, password } = await createOrganizerUserAndEvent(
    contactName,
    email,
    planKey,
    {
      name: eventName,
      eventDate,
      expiresAt,
      moderation,
      visibility,
      password: galleryPassword,
      ...(choice && choice.template.key !== "plain"
        ? { accentColor: choice.colorway.accent, backgroundColor: choice.colorway.background }
        : {}),
      templateKey: choice?.template.key ?? null,
      templateFields: choice ? fieldsForTemplate(choice.template, parsed.data.templateFields ?? null) : null,
    },
  );

  // The plan is a ledger grant like any other, licensing the event created
  // with the account. Reaching this route is the superadmin's decision, which
  // is the reason the ledger asks for.
  await grantEntitlement({
    userId: user.id,
    planKey,
    source: "admin",
    reason: "Provisioned with the account at /admin/new",
    grantedBy: { id: session.user.id, label: session.user.username ?? session.user.name ?? null },
    applyToEventId: draft.id,
  });
  const [event] = await db.select().from(events).where(eq(events.id, draft.id)).limit(1);

  return NextResponse.json(
    {
      username: user.username,
      password, // shown once here, never retrievable again after this response
      userId: user.id,
      event: toPublicEvent(event),
    },
    { status: 201 },
  );
}
