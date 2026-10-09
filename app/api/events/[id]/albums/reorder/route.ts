import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";
import { reorderFolders, touchEvent } from "@/lib/folders";

const reorderSchema = z.object({
  parentId: z.string().min(1).max(64).nullable(),
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
});

/** MED-4: one level's folders, in the order given. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(event.id, event.ownerId, "albums.manage");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseAlbums(eventPlan(event).key)) {
    return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
  }

  const parsed = reorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

  const moved = await reorderFolders(id, parsed.data.parentId, parsed.data.ids);
  if (moved > 0) await touchEvent(id);
  return NextResponse.json({ ok: true, moved });
}
