import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events } from "@/lib/schema";
import { requireEventManagerSession } from "@/lib/roles";
import { getAccountPlan } from "@/lib/account-plans";
import { canUseAlbums } from "@/lib/plans";

const patchAlbumSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

async function getManagedAlbum(eventId: string, albumId: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return { album: null, session: null, event: null };
  const session = await requireEventManagerSession(event.id, event.ownerId);
  const [album] = await db
    .select()
    .from(albums)
    .where(and(eq(albums.id, albumId), eq(albums.eventId, eventId), isNull(albums.deletedAt)))
    .limit(1);
  return { album, session, event };
}

async function ensureAlbumPlan(ownerId: string) {
  const plan = await getAccountPlan(ownerId);
  return canUseAlbums(plan.key);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; albumId: string }> },
) {
  const { id, albumId } = await params;
  const result = await getManagedAlbum(id, albumId);
  if (!result.event || !result.album) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!result.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ensureAlbumPlan(result.event.ownerId))) {
    return NextResponse.json({ error: "Album management requires Klik Premium" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an album name" }, { status: 400 });
  }

  const [album] = await db
    .update(albums)
    .set({ name: parsed.data.name })
    .where(eq(albums.id, albumId))
    .returning();
  return NextResponse.json({ album });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; albumId: string }> },
) {
  const { id, albumId } = await params;
  const result = await getManagedAlbum(id, albumId);
  if (!result.event || !result.album) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!result.session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ensureAlbumPlan(result.event.ownerId))) {
    return NextResponse.json({ error: "Album management requires Klik Premium" }, { status: 403 });
  }

  // Soft delete. Media keeps its album_id, so the photos show as unfiled while
  // the folder is in the trash and snap back into place on restore. A hard
  // delete fired ON DELETE SET NULL across every photo in the folder, which
  // quietly discarded the sorting work and could not be undone.
  await db
    .update(albums)
    .set({ deletedAt: new Date() })
    .where(and(eq(albums.id, albumId), isNull(albums.deletedAt)));
  return NextResponse.json({ ok: true });
}
