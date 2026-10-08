import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, venueClients, EVENT_VISIBILITIES } from "@/lib/schema";
import { createEvent, toOrganizerEvent } from "@/lib/events";
import { hasVenueGrant, licenseWithAvailableGrant } from "@/lib/entitlements";
import { getPlan } from "@/lib/plans";
import { SUPPORT_PHONE } from "@/lib/support";
import { recordAccountEvent } from "@/lib/timeline";

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

/**
 * How many drafts an account may hold before it must activate one. Drafts cost
 * nothing to store and cannot be seen or uploaded to, so this is not a revenue
 * control; it only stops a free account turning into an unbounded list.
 */
const MAX_DRAFTS = 5;

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

  // ACT-3. Creating an event no longer needs an activated account: anyone
  // signed in can make a draft, name it, date it and design its sign while
  // they wait. What a draft cannot do is be seen, take an upload, or have a QR
  // code, and those are enforced where they happen (lib/access.ts, the QR
  // route), not here. The old refusal turned the wait into a dead page.
  const [drafts, venue] = await Promise.all([
    db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.ownerId, session.user.id),
          isNull(events.licensedAt),
          isNull(events.deletedAt),
        ),
      ),
    hasVenueGrant(session.user.id),
  ]);
  if (drafts.length >= MAX_DRAFTS) {
    return NextResponse.json(
      {
        error: `You have ${drafts.length} events waiting to go live. Activate or delete one first, or call ${SUPPORT_PHONE} and the Klik team will help.`,
      },
      { status: 409 },
    );
  }

  const hasClientDetails = Boolean(clientId || clientName || clientEmail || clientPhone);
  if (hasClientDetails && !venue) {
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

  const draft = await createEvent({
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
    retentionDays: null,
  });

  // Live straight away when the account has something to spend: a Venue grant
  // with room, or an unused pass. Otherwise it stays a draft, which is normal.
  const license = await licenseWithAvailableGrant(draft);
  const [event] = await db.select().from(events).where(eq(events.id, draft.id)).limit(1);

  // The step that turns an activated account into a working one. Recorded here
  // rather than derived from a row count, because the count says how many they
  // have and this says when the first one appeared, which is the number that
  // tells you whether somebody who paid ever actually started.
  await recordAccountEvent({
    userId: session.user.id,
    kind: "event_created",
    detail: license.licensed
      ? `Created "${event.name}", live on ${getPlan(license.planKey).name}.`
      : `Created "${event.name}" as a draft, waiting for activation.`,
  });

  return NextResponse.json(
    {
      event: toOrganizerEvent(event),
      license: license.licensed
        ? { state: "live", planKey: license.planKey }
        : { state: "draft", reason: license.reason },
    },
    { status: 201 },
  );
}
