import { after, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { createExport, listExports } from "@/lib/exports";
import { kickJobRunner } from "@/lib/jobs";
import { consume } from "@/lib/ratelimit";
import type { MediaExport } from "@/lib/schema";

export const runtime = "nodejs";

const requestSchema = z.object({
  // A selection from the grid, or a folder, or neither for the whole gallery.
  mediaIds: z.array(z.string().min(1).max(64)).max(5000).optional(),
  albumId: z.string().min(1).max(64).optional(),
});

/** What the dashboard is told about an export: never the object keys. */
function summarize(row: MediaExport) {
  return {
    id: row.id,
    status: row.status,
    label: row.label,
    partCount: row.partCount,
    partsDone: row.partsDone,
    totalBytes: row.totalBytes,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    parts: row.parts.map((part, index) => ({
      number: index + 1,
      ready: Boolean(part.key),
      bytes: part.bytes,
      files: part.files,
    })),
  };
}

async function loadEvent(id: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  return event ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.exportAll");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await listExports(event.id);
  return NextResponse.json(
    { exports: rows.map(summarize) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * MED-7: asks for a ZIP of the gallery, a folder, or a selection, built in the
 * background. Same capability as the streamed ZIP: a contributor may add to a
 * gallery but may not walk off with all of it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "media.exportAll");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Each export copies the gallery once more into the bucket, so a stuck
  // button pressed in a loop is a storage bill. Ten an hour is generous.
  const limit = await consume(`exports:${event.id}`, 10, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Several downloads are already being prepared. Use one of those, or try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const { mediaIds, albumId } = parsed.data;
  let label = "Everything";
  if (albumId) {
    const [album] = await db
      .select({ name: albums.name })
      .from(albums)
      .where(and(eq(albums.id, albumId), eq(albums.eventId, event.id), isNull(albums.deletedAt)))
      .limit(1);
    if (!album) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    label = album.name;
  } else if (mediaIds) {
    label = `${mediaIds.length} selected`;
  }

  // Approved and not deleted, the same set the streamed ZIP has always used.
  const items = await db
    .select({ id: media.id, sizeBytes: media.sizeBytes })
    .from(media)
    .where(
      and(
        eq(media.eventId, event.id),
        eq(media.status, "approved"),
        isNull(media.deletedAt),
        ...(albumId ? [eq(media.albumId, albumId)] : []),
        ...(mediaIds ? [inArray(media.id, mediaIds)] : []),
      ),
    )
    .orderBy(asc(media.createdAt));
  if (items.length === 0) {
    return NextResponse.json({ error: "There is no approved media to download" }, { status: 404 });
  }

  const row = await createExport({
    eventId: event.id,
    requestedByUserId: actor.session.user.id,
    label,
    items,
  });
  after(kickJobRunner);
  return NextResponse.json({ export: summarize(row) }, { status: 201 });
}
