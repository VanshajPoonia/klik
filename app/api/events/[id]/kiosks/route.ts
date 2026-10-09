import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { canUseAlbums, canUseKiosk } from "@/lib/plans";
import { createKiosk, KioskLimitError, listKiosks, MAX_KIOSKS_PER_EVENT } from "@/lib/kiosks";
import { getAppUrl } from "@/lib/env";
import { recordAudit } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  albumId: z.string().min(1).max(64).nullable().optional(),
});

/** VEN-2: the event's kiosks, for whoever may change its settings. */
async function getManagedEvent(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, actor: null };
  return { event, actor: await requireEventCapability(event.id, event.ownerId, "event.settings") };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ kiosks: await listKiosks(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = eventPlan(event);
  if (!canUseKiosk(plan.key)) {
    return NextResponse.json({ error: "Kiosk mode is part of Klik Premium and Klik Venue" }, { status: 403 });
  }
  if (eventLicenseState(event) !== "live") {
    return NextResponse.json({ error: "Kiosks can be set up once the event is live" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the kiosk" }, { status: 400 });

  let albumId: string | null = null;
  if (parsed.data.albumId && canUseAlbums(plan.key)) {
    const [folder] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(
        and(
          eq(albums.id, parsed.data.albumId),
          eq(albums.eventId, id),
          eq(albums.kind, "manual"),
          isNull(albums.deletedAt),
        ),
      )
      .limit(1);
    if (!folder) return NextResponse.json({ error: "That folder is not in this event any more" }, { status: 404 });
    albumId = folder.id;
  }

  try {
    const { kiosk, code } = await createKiosk({
      eventId: id,
      name: parsed.data.name,
      albumId,
      createdBy: actor.session.user?.id ?? null,
    });
    await recordAudit({
      actor: actor.session,
      action: "kiosk.created",
      targetType: "kiosk",
      targetId: kiosk.id,
      eventId: id,
      detail: kiosk.name,
    });
    return NextResponse.json({ kiosk: { id: kiosk.id }, pairUrl: `${getAppUrl()}/k/${code}` }, { status: 201 });
  } catch (error) {
    if (error instanceof KioskLimitError) {
      return NextResponse.json(
        { error: `An event can have up to ${MAX_KIOSKS_PER_EVENT} kiosks. Switch one off first.` },
        { status: 409 },
      );
    }
    throw error;
  }
}
