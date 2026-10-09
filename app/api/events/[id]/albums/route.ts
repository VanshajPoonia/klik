import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";
import { createFolder, FOLDER_REFUSAL_MESSAGES, FolderError, listFolders, touchEvent } from "@/lib/folders";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // MED-4: inside another folder. Absent or null is the top level.
  parentId: z.string().min(1).max(64).nullable().optional(),
});

async function getManagedEvent(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, session: null };
  const session = (await requireEventCapability(event.id, event.ownerId, "albums.manage"))?.session ?? null;
  return { event, session };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ albums: await listFolders(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = eventPlan(event);
  if (!canUseAlbums(plan.key)) {
    return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the folder" }, { status: 400 });

  try {
    // PAY-6: the cap comes from the plan, and counts folders at every level.
    const album = await createFolder({
      eventId: id,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
      maxFolders: plan.maxAlbums,
    });
    await touchEvent(id);
    return NextResponse.json({ album }, { status: 201 });
  } catch (error) {
    if (error instanceof FolderError) {
      const message =
        error.reason === "limit"
          ? `An event on ${plan.name} can have up to ${plan.maxAlbums} folders`
          : FOLDER_REFUSAL_MESSAGES[error.reason];
      return NextResponse.json({ error: message }, { status: 409 });
    }
    throw error;
  }
}
