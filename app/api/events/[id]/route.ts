import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  events,
  media,
  venueClients,
  EVENT_VISIBILITIES,
  QR_TEMPLATES,
} from "@/lib/schema";
import { toOrganizerEvent, hashGalleryPassword } from "@/lib/events";
import { requireEventManagerSession, requireOwnerSession } from "@/lib/roles";
import { deleteBlobs } from "@/lib/storage";
import { getAccountPlan } from "@/lib/account-plans";
import {
  canCustomizeGallery,
  canCustomizeQr,
  canManageEventClients,
  canUseVenueHub,
} from "@/lib/plans";
import { isEventActive } from "@/lib/access";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  eventDate: z.coerce.date().nullable().optional(),
  clientName: z.string().trim().max(120).nullable().optional(),
  clientEmail: z
    .union([z.literal(""), z.string().trim().email().max(254)])
    .nullable()
    .optional(),
  clientPhone: z.string().trim().max(40).nullable().optional(),
  clientId: z.string().min(10).max(64).nullable().optional(),
  coverMediaId: z.string().min(10).max(64).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  qrTemplate: z.enum(QR_TEMPLATES).optional(),
  venueFeatured: z.boolean().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  password: z.string().min(4).max(72).optional(),
  moderation: z.boolean().optional(),
  isActive: z.boolean().optional(),
  downloadsEnabled: z.boolean().optional(),
  uploadsEnabled: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

async function getOwnedEvent(id: string) {
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return { event: null, session: null };
  const session = await requireEventManagerSession(event.id, event.ownerId);
  return { event, session };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ event: toOrganizerEvent(event) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const clientFieldsRequested =
    "clientId" in parsed.data ||
    "clientName" in parsed.data ||
    "clientEmail" in parsed.data ||
    "clientPhone" in parsed.data;
  const plan = await getAccountPlan(event.ownerId);
  if (clientFieldsRequested) {
    if (!canManageEventClients(plan.key)) {
      return NextResponse.json(
        { error: "Client details are available on the Klik Venue plan" },
        { status: 403 },
      );
    }
  }
  const galleryCustomizationRequested =
    "coverMediaId" in parsed.data ||
    "accentColor" in parsed.data ||
    "backgroundColor" in parsed.data;
  if (galleryCustomizationRequested && !canCustomizeGallery(plan.key)) {
    return NextResponse.json(
      { error: "Gallery customization is available on the Klik Premium plan" },
      { status: 403 },
    );
  }
  if ("qrTemplate" in parsed.data && !canCustomizeQr(plan.key)) {
    return NextResponse.json(
      { error: "Custom QR templates are available on the Klik Premium plan" },
      { status: 403 },
    );
  }
  if ("venueFeatured" in parsed.data && !canUseVenueHub(plan.key)) {
    return NextResponse.json(
      { error: "The reusable venue QR is available on the Klik Venue plan" },
      { status: 403 },
    );
  }

  if (parsed.data.coverMediaId) {
    const [cover] = await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.id, parsed.data.coverMediaId),
          eq(media.eventId, id),
          eq(media.kind, "photo"),
          eq(media.status, "approved"),
        ),
      )
      .limit(1);
    if (!cover) {
      return NextResponse.json(
        { error: "Choose an approved photo from this event as the cover" },
        { status: 400 },
      );
    }
  }

  let selectedClient:
    | { id: string; name: string; email: string | null; phone: string | null }
    | undefined;
  if (parsed.data.clientId) {
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
          eq(venueClients.id, parsed.data.clientId),
          eq(venueClients.ownerId, event.ownerId),
        ),
      )
      .limit(1);
    if (!selectedClient) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  }

  if (parsed.data.isActive && !isEventActive(event)) {
    const ownerEvents = await db
      .select({ isActive: events.isActive, expiresAt: events.expiresAt })
      .from(events)
      .where(eq(events.ownerId, event.ownerId));
    const activeCount = ownerEvents.filter((candidate) => isEventActive(candidate)).length;
    if (activeCount >= plan.maxActiveEvents) {
      return NextResponse.json(
        { error: `${plan.name} already has its maximum number of active events` },
        { status: 409 },
      );
    }
  }

  const { password, ...restInput } = parsed.data;
  const rest = selectedClient
    ? {
        ...restInput,
        clientName: selectedClient.name,
        clientEmail: selectedClient.email,
        clientPhone: selectedClient.phone,
      }
    : restInput;
  const nextVisibility = rest.visibility ?? event.visibility;
  const enteringPasswordProtection =
    nextVisibility === "password" && event.visibility !== "password";
  if (
    nextVisibility === "password" &&
    !password &&
    (enteringPasswordProtection || !event.passwordHash)
  ) {
    return NextResponse.json(
      { error: "Password required for password-protected events" },
      { status: 400 },
    );
  }
  if (password && nextVisibility !== "password") {
    return NextResponse.json(
      { error: "A gallery password can only be set for password-protected events" },
      { status: 400 },
    );
  }

  const passwordHashUpdate = nextVisibility === "password" && password
    ? { passwordHash: await hashGalleryPassword(password) }
    : rest.visibility && rest.visibility !== "password"
      ? { passwordHash: null }
      : {};

  let updated;
  try {
    const updateQuery = db
      .update(events)
      .set({
        ...rest,
        ...passwordHashUpdate,
        ...(password || (rest.visibility && rest.visibility !== event.visibility)
          ? { accessVersion: sql`${events.accessVersion} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(events.id, id))
      .returning();

    if (rest.venueFeatured) {
      const clearFeaturedQuery = db
        .update(events)
        .set({ venueFeatured: false, updatedAt: new Date() })
        .where(eq(events.ownerId, event.ownerId));
      const [, updatedRows] = await db.batch([clearFeaturedQuery, updateQuery]);
      [updated] = updatedRows;
    } else {
      [updated] = await updateQuery;
    }
  } catch (error) {
    const errorCode = (error as { code?: string })?.code;
    if (error instanceof Error && error.message.includes("event_active_limit")) {
      return NextResponse.json(
        { error: "The plan active-event limit has been reached" },
        { status: 409 },
      );
    }
    if (errorCode === "23505" && rest.venueFeatured) {
      return NextResponse.json(
        { error: "Another event was featured at the same time. Refresh and try again." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ event: toOrganizerEvent(updated) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({ pathname: media.blobPathname })
    .from(media)
    .where(eq(media.eventId, id));
  await deleteBlobs(rows.map((r) => r.pathname));
  await db.delete(events).where(eq(events.id, id));

  return NextResponse.json({ ok: true });
}
