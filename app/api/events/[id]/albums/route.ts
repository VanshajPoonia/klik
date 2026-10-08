import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";

const createAlbumSchema = z.object({
  name: z.string().trim().min(1).max(60),
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

  const rows = await db.select().from(albums).where(and(eq(albums.eventId, id), isNull(albums.deletedAt))).orderBy(albums.createdAt);
  return NextResponse.json({ albums: rows });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getManagedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = eventPlan(event);
  if (!canUseAlbums(plan.key)) {
    return NextResponse.json(
      { error: "Multiple albums are available on the Klik Premium plan" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an album name" }, { status: 400 });
  }

  const existing = await db.select({ id: albums.id }).from(albums).where(and(eq(albums.eventId, id), isNull(albums.deletedAt)));
  if (existing.length >= 20) {
    return NextResponse.json({ error: "An event can have up to 20 albums" }, { status: 409 });
  }

  const [album] = await db
    .insert(albums)
    .values({ id: nanoid(), eventId: id, name: parsed.data.name })
    .returning();

  return NextResponse.json({ album }, { status: 201 });
}
