import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { GUEST_LANGUAGES } from "@/lib/i18n/locale";
import { canUseProofs } from "@/lib/plans";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  events,
  media,
  venueClients,
  EVENT_VISIBILITIES,
  QR_TEMPLATES,
} from "@/lib/schema";
import { toOrganizerEvent, hashGalleryPassword } from "@/lib/events";
import { eraseEvent, LegalHoldError } from "@/lib/erasure";
import { requireEventCapability, requireEventManagerSession, requireOwnerSession } from "@/lib/roles";
import type { EventCapability } from "@/lib/permissions";
import { describeLicenseRefusal, eventPlan } from "@/lib/license";
import { changeEventSlug, validateCustomSlug } from "@/lib/slugs";
import {
  canCustomizeGallery,
  canCustomizeQr,
  canManageEventClients,
  canUseVenueHub,
} from "@/lib/plans";
import { isUniqueViolation, raisedBy } from "@/lib/db-errors";

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
  // MED-9. Any plan: a gallery people talk about is the product working.
  reactionsEnabled: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  // AI-1. On by default; the team always sees moments either way.
  momentsEnabled: z.boolean().optional(),
  // GRW-1. On by default: it only offers, each guest still chooses.
  recapEnabled: z.boolean().optional(),
  // GRW-4. Listed on the owner's public profile, so only the owner sets it.
  showOnProfile: z.boolean().optional(),
  // TRS-3. The language guests see, unless they choose their own.
  guestLanguage: z.enum(GUEST_LANGUAGES).optional(),
  // MED-8. Premium and Venue, the plans with a photographer on the team.
  keepPhotoDetails: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  // CAM-4. Developing early is `developsAt: <now>`; there is no separate verb,
  // because "develop now" and "develop at this time" are the same setting.
  // QR-1: a custom address. Validated by lib/slugs.ts, not here, so the rules
  // live in one place.
  slug: z.string().max(80).optional(),
  disposableMode: z.boolean().optional(),
  shotsPerGuest: z.number().int().min(1).max(200).optional(),
  developsAt: z.coerce.date().nullable().optional(),
});

/**
 * `capability` narrows who gets through. Reading the event is open to anyone on
 * the team; changing its settings is not, which is the difference between a
 * moderator and a manager. Omitting it keeps the old coarse "are you on the
 * team at all" behaviour, which is what GET wants.
 */
async function getOwnedEvent(id: string, capability?: EventCapability) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, session: null };
  const session = capability
    ? (await requireEventCapability(event.id, event.ownerId, capability))?.session ?? null
    : await requireEventManagerSession(event.id, event.ownerId);
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
  const { event, session } = await getOwnedEvent(id, "event.settings");
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

  if (parsed.data.showOnProfile !== undefined && session.user?.id !== event.ownerId && session.user?.role !== "superadmin") {
    return NextResponse.json({ error: "Only the event's owner can list it on their profile." }, { status: 403 });
  }
  if (parsed.data.showOnProfile && (parsed.data.visibility ?? event.visibility) === "private") {
    return NextResponse.json({ error: "A private gallery cannot be listed on a public profile." }, { status: 400 });
  }

  if (parsed.data.keepPhotoDetails && !canUseProofs(eventPlan(event).key)) {
    return NextResponse.json({ error: "Keeping camera details is part of Klik Premium and Venue." }, { status: 403 });
  }

  const clientFieldsRequested =
    "clientId" in parsed.data ||
    "clientName" in parsed.data ||
    "clientEmail" in parsed.data ||
    "clientPhone" in parsed.data;
  // The event's own plan since ACT-1. An event licensed by a Venue grant runs on
  // Venue; a Venue account's extra Event pass runs on Event, features and all.
  const plan = eventPlan(event);
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
          isNull(venueClients.deletedAt),
        ),
      )
      .limit(1);
    if (!selectedClient) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  }

  // QR-1: a new address, on plans that offer it. Applied on its own, before the
  // rest, because it is one atomic statement that keeps the old address alive.
  const { slug: requestedSlug, ...withoutSlug } = parsed.data;
  if (requestedSlug !== undefined && requestedSlug.trim().toLowerCase() !== event.slug) {
    if (plan.key === "event") {
      return NextResponse.json(
        { error: "A custom gallery address is part of Klik Premium and Klik Venue" },
        { status: 403 },
      );
    }
    const check = validateCustomSlug(requestedSlug);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    const changed = await changeEventSlug(event.id, check.slug);
    if (!changed.ok) return NextResponse.json({ error: changed.reason }, { status: 409 });
    await recordAudit({
      actor: session,
      action: "event.address_changed",
      targetType: "event",
      targetId: event.id,
      eventId: event.id,
      detail: `From /e/${event.slug} to /e/${check.slug}. The old address still works.`,
    });
  }

  const { password, ...restInput } = withoutSlug;
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
      .where(and(eq(events.id, id), isNull(events.deletedAt)))
      .returning();

    if (rest.venueFeatured) {
      const clearFeaturedQuery = db
        .update(events)
        .set({ venueFeatured: false, updatedAt: new Date() })
        .where(and(eq(events.ownerId, event.ownerId), isNull(events.deletedAt)));
      const [, updatedRows] = await db.batch([clearFeaturedQuery, updateQuery]);
      [updated] = updatedRows;
    } else {
      [updated] = await updateQuery;
    }
  } catch (error) {
        // Re-opening an event under a Venue grant that is already at its live-event
    // limit. The trigger in drizzle/0018 decides, from the grant's own numbers.
    if (raisedBy(error, "entitlement_active_limit")) {
      return NextResponse.json(
        { error: describeLicenseRefusal("entitlement_active_limit", plan) },
        { status: 409 },
      );
    }
    if (isUniqueViolation(error) && rest.venueFeatured) {
      return NextResponse.json(
        { error: "Another event was featured at the same time. Refresh and try again." },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ event: toOrganizerEvent(updated) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const erase = new URL(request.url).searchParams.get("erase") === "true";
  // TRS-2: erasing reaches an event already in the trash too, which is where an
  // owner looks for "delete it for good now".
  const [event] = erase
    ? await db.select().from(events).where(eq(events.id, id)).limit(1)
    : [(await getOwnedEvent(id)).event];
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ?erase=true skips the recovery window entirely and destroys the bytes now.
  // It exists for the case soft delete cannot serve: someone has asked for
  // their data to be removed, and "it is in a trash folder for 30 days" is not
  // an answer to that. It is opt-in because it is the only delete here that
  // cannot be walked back.
  if (erase) {
    let result;
    try {
      result = await eraseEvent(event.id, session.user?.id ?? null, "event_erasure_request");
    } catch (error) {
      // TRS-1: something in scope is under a legal hold, which an erasure
      // request does not override. Klik resolves these by hand.
      if (error instanceof LegalHoldError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    await recordAudit({ actor: session, action: "event.erased", targetType: "event", targetId: event.id, detail: event.name });
    return NextResponse.json({ ok: true, erased: true, ...result });
  }

  // Soft delete. Deleting an event destroys every guest's photos from that
  // night, not just the organizer's own, so it gets the same 30-day recovery
  // window as a single photo. The purge cron removes the row and the objects
  // once that window closes. See ROADMAP.md SEC-4.
  await db
    .update(events)
    .set({
      deletedAt: new Date(),
      isActive: false,
      uploadsEnabled: false,
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, id), isNull(events.deletedAt)));

  await recordAudit({ actor: session, action: "event.deleted", targetType: "event", targetId: id, eventId: id });
  return NextResponse.json({ ok: true });
}
