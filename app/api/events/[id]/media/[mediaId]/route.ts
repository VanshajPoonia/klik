import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, MEDIA_STATUSES } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { deleteBlobs } from "@/lib/storage";

const patchSchema = z.object({
  status: z.enum(MEDIA_STATUSES),
});

async function getOwnedEventMedia(eventId: string, mediaId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { item: null, session: null };
  const session = await requireOwnerSession(event.ownerId);
  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, eventId)))
    .limit(1);
  return { item, session };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const { item, session } = await getOwnedEventMedia(id, mediaId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const [updated] = await db
    .update(media)
    .set({ status: parsed.data.status })
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

  return NextResponse.json({ ok: true });
}
