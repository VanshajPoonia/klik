import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";
import { deleteFolder, FOLDER_REFUSAL_MESSAGES, FolderError, touchEvent, updateFolder } from "@/lib/folders";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    // MED-4: move it. Null is the top level.
    parentId: z.string().min(1).max(64).nullable().optional(),
    // The host's choice of cover. Null goes back to the newest photo in it.
    coverMediaId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to change");

async function getManagedEvent(eventId: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, session: null };
  const session = (await requireEventCapability(event.id, event.ownerId, "albums.manage"))?.session ?? null;
  return { event, session };
}

function refusal(error: unknown) {
  if (error instanceof FolderError) {
    return NextResponse.json(
      { error: FOLDER_REFUSAL_MESSAGES[error.reason] },
      { status: error.reason === "not_found" ? 404 : 409 },
    );
  }
  throw error;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; albumId: string }> }) {
  const { id, albumId } = await params;
  const { event, session } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseAlbums(eventPlan(event).key)) {
    return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const album = await updateFolder(id, albumId, parsed.data);
    await touchEvent(id);
    return NextResponse.json({ album });
  } catch (error) {
    return refusal(error);
  }
}

/**
 * Soft delete, of the folder and everything beneath it. Photos keep their
 * folder, so they show as unfiled while it is in the trash and snap back into
 * place on restore. A hard delete fired ON DELETE SET NULL across every photo
 * in it, which quietly discarded the sorting work and could not be undone.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; albumId: string }> }) {
  const { id, albumId } = await params;
  const { event, session } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseAlbums(eventPlan(event).key)) {
    return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
  }

  const deleted = await deleteFolder(id, albumId);
  if (deleted === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await touchEvent(id);
  return NextResponse.json({ ok: true, folders: deleted });
}
