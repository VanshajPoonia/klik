import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media, MEDIA_STATUSES, MEDIA_VISIBILITIES } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import type { EventCapability } from "@/lib/permissions";
import { getAccountPlan } from "@/lib/account-plans";
import { canUseAlbums } from "@/lib/plans";

const patchSchema = z
  .object({
    status: z.enum(MEDIA_STATUSES).optional(),
    // Orthogonal to status on purpose. Hiding a photo must not send it back to
    // the moderation queue, and approving one must not un-hide it.
    visibility: z.enum(MEDIA_VISIBILITIES).optional(),
    albumId: z.string().min(10).max(64).nullable().optional(),
  })
  .refine(
    (input) =>
      input.status !== undefined ||
      input.visibility !== undefined ||
      input.albumId !== undefined,
    { message: "No changes provided" },
  );

async function getOwnedEventMedia(eventId: string, mediaId: string, capability: EventCapability) {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return { item: null, session: null, event: null };
  // A contributor holds neither of these capabilities. The photographer you
  // hired should not be able to remove a guest's photo of the event.
  const session = (await requireEventCapability(event.id, event.ownerId, capability))?.session ?? null;
  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, eventId), isNull(media.deletedAt)))
    .limit(1);
  return { item, session, event };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const { item, session, event } = await getOwnedEventMedia(id, mediaId, "media.moderate");
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid media update" }, { status: 400 });
  }
  if (parsed.data.albumId) {
    const plan = await getAccountPlan(event!.ownerId);
    if (!canUseAlbums(plan.key)) {
      return NextResponse.json(
        { error: "Multiple albums are available on the Klik Premium plan" },
        { status: 403 },
      );
    }
    const [album] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(and(eq(albums.id, parsed.data.albumId), eq(albums.eventId, id), isNull(albums.deletedAt)))
      .limit(1);
    if (!album) return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(media)
    .set(parsed.data)
    .where(eq(media.id, mediaId))
    .returning();

  return NextResponse.json({ media: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const { item, session } = await getOwnedEventMedia(id, mediaId, "media.delete");
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Soft delete: the row and its object survive for 30 days so a mis-click or
  // a disagreement between co-hosts is recoverable. The purge cron removes
  // both once that window closes. These photos are irreplaceable and the
  // storage to hold them a month is not. See ROADMAP.md SEC-4.
  await db
    .update(media)
    .set({ deletedAt: new Date() })
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)));
  await db
    .update(events)
    .set({ coverMediaId: null, updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.coverMediaId, mediaId)));

  return NextResponse.json({ ok: true });
}
