import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { touchEvent } from "@/lib/folders";
import { deleteSmartFolder, renameSmartFolder } from "@/lib/search";

const renameSchema = z.object({ name: z.string().trim().min(1).max(60) });

async function managed(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, actor: null };
  return { event, actor: await requireEventCapability(event.id, event.ownerId, "albums.manage") };
}

/** AI-4: rename a smart folder. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; folderId: string }> }) {
  const { id, folderId } = await params;
  const { event, actor } = await managed(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the folder" }, { status: 400 });
  if (!(await renameSmartFolder(event.id, folderId, parsed.data.name))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await touchEvent(event.id);
  return NextResponse.json({ ok: true });
}

/** AI-4: delete a smart folder. Its photos are untouched; it only held a question. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; folderId: string }> }) {
  const { id, folderId } = await params;
  const { event, actor } = await managed(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await deleteSmartFolder(event.id, folderId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await touchEvent(event.id);
  return NextResponse.json({ ok: true });
}
