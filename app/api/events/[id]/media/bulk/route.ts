import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media, MEDIA_VISIBILITIES } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";
import { resolveReportsFor } from "@/lib/reports";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({ action: z.literal("reject"), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({
    action: z.literal("visibility"),
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
    visibility: z.enum(MEDIA_VISIBILITIES),
  }),
  z.object({
    action: z.literal("move"),
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
    albumId: z.string().min(1).max(64).nullable(),
  }),
  z.object({ action: z.literal("delete"), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
  z.object({ action: z.literal("restore"), ids: z.array(z.string().min(1).max(64)).min(1).max(500) }),
]);

/**
 * MED-5: the same changes the per-photo controls make, to a whole selection.
 *
 * One statement per request, scoped to this event in the WHERE clause, so an
 * id from somebody else's gallery matches nothing rather than crossing over,
 * and the count returned is what changed rather than what was asked for. The
 * same capabilities as the single-photo routes: moderating for every change,
 * deleting for delete. Photos under a legal hold are skipped by every action,
 * as they are one at a time.
 *
 * Delete is the usual soft delete, so "Undo" is `restore` on the same ids and
 * the trash keeps them for 30 days after that window.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid selection" }, { status: 400 });
  const input = parsed.data;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const capability = input.action === "delete" || input.action === "restore" ? "media.delete" : "media.moderate";
  const actor = await requireEventCapability(event.id, event.ownerId, capability);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = and(eq(media.eventId, event.id), inArray(media.id, input.ids), isNull(media.legalHoldAt));
  let changed: Array<{ id: string }> = [];

  switch (input.action) {
    case "approve":
    case "reject":
      changed = await db
        .update(media)
        .set({ status: input.action === "approve" ? "approved" : "rejected" })
        .where(and(scope, isNull(media.deletedAt)))
        .returning({ id: media.id });
      break;
    case "visibility":
      changed = await db
        .update(media)
        .set({ visibility: input.visibility })
        .where(and(scope, isNull(media.deletedAt)))
        .returning({ id: media.id });
      break;
    case "move": {
      if (input.albumId) {
        if (!canUseAlbums(eventPlan(event).key)) {
          return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
        }
        const [album] = await db
          .select({ id: albums.id })
          .from(albums)
          .where(and(eq(albums.id, input.albumId), eq(albums.eventId, event.id), isNull(albums.deletedAt)))
          .limit(1);
        if (!album) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      changed = await db
        .update(media)
        .set({ albumId: input.albumId })
        .where(and(scope, isNull(media.deletedAt)))
        .returning({ id: media.id });
      break;
    }
    case "delete":
      changed = await db
        .update(media)
        .set({ deletedAt: new Date() })
        .where(and(scope, isNull(media.deletedAt)))
        .returning({ id: media.id });
      if (changed.length > 0) {
        const deletedIds = changed.map((row) => row.id);
        await db
          .update(events)
          .set({ coverMediaId: null, updatedAt: new Date() })
          .where(and(eq(events.id, event.id), inArray(events.coverMediaId, deletedIds)));
        // A host deleting reported photos is their answer to the reports.
        await resolveReportsFor(deletedIds, { byUserId: actor.session.user.id, resolution: "Removed by the host" });
      }
      break;
    case "restore":
      changed = await db
        .update(media)
        .set({ deletedAt: null })
        .where(scope)
        .returning({ id: media.id });
      break;
  }

  return NextResponse.json({ ok: true, changed: changed.map((row) => row.id) });
}
