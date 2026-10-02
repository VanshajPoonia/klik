import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { mediaContentPath, mediaPosterPath } from "@/lib/media-delivery";

/**
 * The trash for one event: what has been soft-deleted, and the way back.
 *
 * Soft delete without a restore path is just a slower delete that also costs
 * storage. Until this existed, recovering a photo someone removed by mistake
 * meant an UPDATE by hand against production.
 */

/** Matches TRASH_RETENTION_DAYS in the purge cron. */
const TRASH_RETENTION_DAYS = 30;

async function requireManager(eventId: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return { event: null, session: null };
  const session = (await requireEventCapability(event.id, event.ownerId, "trash.manage"))?.session ?? null;
  return { event, session };
}

function expiresAt(deletedAt: Date): string {
  return new Date(
    deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await requireManager(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [deletedMedia, deletedAlbums] = await Promise.all([
    db
      .select()
      .from(media)
      .where(and(eq(media.eventId, id), isNotNull(media.deletedAt))),
    db
      .select()
      .from(albums)
      .where(and(eq(albums.eventId, id), isNotNull(albums.deletedAt))),
  ]);

  return NextResponse.json({
    retentionDays: TRASH_RETENTION_DAYS,
    media: deletedMedia.map((item) => ({
      id: item.id,
      kind: item.kind,
      deletedAt: item.deletedAt,
      purgesAt: item.deletedAt ? expiresAt(item.deletedAt) : null,
      // Trashed items still preview, or the organizer is restoring blind.
      blobUrl: mediaContentPath(event.slug, item.id),
      posterUrl: item.posterPathname ? mediaPosterPath(event.slug, item.id) : null,
    })),
    albums: deletedAlbums.map((album) => ({
      id: album.id,
      name: album.name,
      deletedAt: album.deletedAt,
      purgesAt: album.deletedAt ? expiresAt(album.deletedAt) : null,
    })),
  });
}

const restoreSchema = z.object({
  mediaIds: z.array(z.string().min(10).max(64)).max(500).optional(),
  albumIds: z.array(z.string().min(10).max(64)).max(100).optional(),
});

/** Restores soft-deleted items back into the gallery. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await requireManager(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing to restore" }, { status: 400 });
  }

  const { mediaIds = [], albumIds = [] } = parsed.data;
  if (mediaIds.length === 0 && albumIds.length === 0) {
    return NextResponse.json({ error: "Nothing to restore" }, { status: 400 });
  }

  // One statement per table, not per id. Restoring a 500-photo selection used
  // to mean 500 sequential round trips to Neon, which is slow enough to exceed
  // the function timeout on exactly the bulk restore this endpoint exists for.
  //
  // Both are scoped to this event in the WHERE clause, so an id belonging to
  // someone else's gallery matches nothing rather than crossing the boundary.
  // The counts come from RETURNING, not from the request, so the response
  // reports what actually changed.
  const restoredMediaRows = mediaIds.length
    ? await db
        .update(media)
        .set({ deletedAt: null })
        .where(
          and(inArray(media.id, mediaIds), eq(media.eventId, id), isNotNull(media.deletedAt)),
        )
        .returning({ id: media.id })
    : [];

  const restoredAlbumRows = albumIds.length
    ? await db
        .update(albums)
        .set({ deletedAt: null })
        .where(
          and(inArray(albums.id, albumIds), eq(albums.eventId, id), isNotNull(albums.deletedAt)),
        )
        .returning({ id: albums.id })
    : [];

  const restoredMedia = restoredMediaRows.length;
  const restoredAlbums = restoredAlbumRows.length;

  return NextResponse.json({ ok: true, restoredMedia, restoredAlbums });
}
