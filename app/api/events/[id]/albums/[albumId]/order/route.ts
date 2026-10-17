import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { touchEvent } from "@/lib/folders";

/**
 * MED-16: the order of the photos filed in one folder. PUT gives every photo
 * named its place, in the order named, and takes the place away from any
 * other photo in the folder (one that arrived while the host was arranging
 * goes after them); DELETE puts the folder back in its usual order.
 */

/** A folder this large is not arranged by hand. */
const MAX_ARRANGED = 2000;

const putSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_ARRANGED) });

type Params = { params: Promise<{ id: string; albumId: string }> };

async function load(eventId: string, albumId: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return { status: 404 as const };
  const actor = await requireEventCapability(event.id, event.ownerId, "albums.manage");
  if (!actor) return { status: 401 as const };
  const [folder] = await db
    .select({ id: albums.id })
    .from(albums)
    .where(and(eq(albums.id, albumId), eq(albums.eventId, event.id), isNull(albums.deletedAt), eq(albums.kind, "manual")))
    .limit(1);
  if (!folder) return { status: 404 as const };
  return { status: 200 as const, event };
}

const inFolder = (eventId: string, albumId: string) =>
  and(eq(media.eventId, eventId), eq(media.albumId, albumId), isNull(media.deletedAt));

export async function PUT(request: Request, { params }: Params) {
  const { id, albumId } = await params;
  const loaded = await load(id, albumId);
  if (loaded.status !== 200) {
    return NextResponse.json({ error: loaded.status === 401 ? "Unauthorized" : "Not found" }, { status: loaded.status });
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the photos in their new order" }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];

  // Every one must still be in this folder; anything moved or deleted since
  // the host started means they are arranging something that is not there.
  const present = await db.select({ id: media.id }).from(media).where(and(inFolder(id, albumId), inArray(media.id, ids)));
  if (present.length !== ids.length) {
    return NextResponse.json(
      { error: "Some of these have moved or gone since you started. Open the folder again and arrange it once more.", code: "stale" },
      { status: 409 },
    );
  }

  // One statement, so a folder is never left half arranged: each photo filed
  // here takes its place in the list, and one not in it (arrived since) none.
  const placed = sql`ARRAY[${sql.join(
    ids.map((mediaId) => sql`${mediaId}`),
    sql`, `,
  )}]::text[]`;
  await db.execute(sql`
    UPDATE media SET folder_position = (
      SELECT placed.ord - 1 FROM unnest(${placed}) WITH ORDINALITY AS placed(id, ord) WHERE placed.id = media.id
    )
    WHERE media.event_id = ${id} AND media.album_id = ${albumId} AND media.deleted_at IS NULL
  `);
  await touchEvent(id);
  return NextResponse.json({ positions: Object.fromEntries(ids.map((mediaId, index) => [mediaId, index])) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, albumId } = await params;
  const loaded = await load(id, albumId);
  if (loaded.status !== 200) {
    return NextResponse.json({ error: loaded.status === 401 ? "Unauthorized" : "Not found" }, { status: loaded.status });
  }
  await db
    .update(media)
    .set({ folderPosition: null })
    .where(and(inFolder(id, albumId), sql`${media.folderPosition} IS NOT NULL`));
  await touchEvent(id);
  return NextResponse.json({ ok: true });
}
