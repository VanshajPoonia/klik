import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { touchEvent } from "@/lib/folders";
import { MAX_SMART_FOLDERS, SmartFolderError, createSmartFolder, listSmartFolders } from "@/lib/search";
import { SCENE_LABELS, normalizeQuery } from "@/lib/vision";
import { reportError } from "@/lib/observability";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  query: z.discriminatedUnion("type", [
    z.object({ type: z.literal("search"), text: z.string().transform(normalizeQuery).pipe(z.string().min(1)) }),
    z.object({ type: z.literal("scene"), label: z.enum(SCENE_LABELS) }),
  ]),
});

async function managed(id: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return { event: null, actor: null };
  return { event, actor: await requireEventCapability(event.id, event.ownerId, "albums.manage") };
}

/**
 * AI-4: a smart folder is a saved search or scene. It holds a question, not
 * photos, so it is on every plan (as folders that hold photos now are too) and a
 * photo can be in any number of them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await managed(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ folders: await listSmartFolders(event.id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await managed(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the folder and what it holds" }, { status: 400 });

  try {
    const folder = await createSmartFolder(event.id, parsed.data);
    // Phones resync and pick the folder up with the rest of the gallery's shape.
    await touchEvent(event.id);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    if (error instanceof SmartFolderError) {
      const message =
        error.code === "too_many"
          ? `An event can have up to ${MAX_SMART_FOLDERS} smart folders`
          : error.code === "not_configured"
            ? "Search is not switched on yet"
            : "That folder could not be saved";
      return NextResponse.json({ error: message, code: error.code }, { status: error.code === "not_configured" ? 503 : 409 });
    }
    reportError("smart_folders.create_failed", error, { eventId: event.id });
    return NextResponse.json({ error: "That folder could not be saved" }, { status: 502 });
  }
}
