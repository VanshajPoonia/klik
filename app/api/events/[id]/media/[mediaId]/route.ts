import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media, MEDIA_STATUSES } from "@/lib/schema";
import { requireEventManagerSession } from "@/lib/roles";
import { deleteBlobs } from "@/lib/storage";
import { getAccountPlan } from "@/lib/account-plans";
import { canUseAlbums } from "@/lib/plans";

const patchSchema = z
  .object({
    status: z.enum(MEDIA_STATUSES).optional(),
    albumId: z.string().min(10).max(64).nullable().optional(),
  })
  .refine((input) => input.status !== undefined || input.albumId !== undefined, {
    message: "No changes provided",
  });

async function getOwnedEventMedia(eventId: string, mediaId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { item: null, session: null, event: null };
  const session = await requireEventManagerSession(event.id, event.ownerId);
  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, eventId)))
    .limit(1);
  return { item, session, event };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const { item, session, event } = await getOwnedEventMedia(id, mediaId);
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
      .where(and(eq(albums.id, parsed.data.albumId), eq(albums.eventId, id)))
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
  const { item, session } = await getOwnedEventMedia(id, mediaId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await deleteBlobs([item.blobPathname]);
  await db.delete(media).where(eq(media.id, mediaId));
  await db
    .update(events)
    .set({ coverMediaId: null, updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.coverMediaId, mediaId)));

  return NextResponse.json({ ok: true });
}
