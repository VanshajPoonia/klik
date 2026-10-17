import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { guestFor } from "@/lib/guest-request";
import { eventPlan } from "@/lib/license";
import { canUseAlbums } from "@/lib/plans";
import { clientIp, consume } from "@/lib/ratelimit";
import { FolderError, FOLDER_REFUSAL_MESSAGES, createFolder, touchEvent } from "@/lib/folders";

/**
 * MED-15: a guest makes a folder, to file their own photos into. It is an
 * ordinary folder of the event from then on: everyone sees it once something
 * is in it, anyone can file their own photos into it, and the hosts rename,
 * hide or delete it like their own. Top level only, five per guest, inside
 * the plan's cap on folders, and only while the host lets guests make them.
 */
const GUEST_FOLDER_LIMIT = 5;

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await guestFor((await params).slug, "Join the gallery to make a folder");
  if (!resolved.ok) return resolved.response;
  const { event, guestId, viewer } = resolved;
  if (!viewer.access.allowed) return NextResponse.json({ error: "This gallery is not open right now.", code: "closed" }, { status: 403 });

  const plan = eventPlan(event);
  if (!event.guestFolders || !canUseAlbums(plan.key)) {
    return NextResponse.json({ error: "The hosts make the folders here.", code: "hosts_only" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the folder", code: "no_name" }, { status: 400 });

  const limit = await consume(`guest-folder:ip:${clientIp(request)}`, 10, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many folders at once. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const [made] = await db
    .select({ n: count() })
    .from(albums)
    .where(and(eq(albums.eventId, event.id), eq(albums.createdByGuestId, guestId), isNull(albums.deletedAt)));
  if ((made?.n ?? 0) >= GUEST_FOLDER_LIMIT) {
    return NextResponse.json({ error: `You can make up to ${GUEST_FOLDER_LIMIT} folders here.`, code: "guest_limit" }, { status: 409 });
  }

  try {
    const folder = await createFolder({
      eventId: event.id,
      name: parsed.data.name,
      parentId: null,
      maxFolders: plan.maxAlbums,
      createdByGuestId: guestId,
    });
    await touchEvent(event.id);
    return NextResponse.json(
      {
        folder: {
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          position: folder.position,
          createdAt: folder.createdAt.toISOString(),
          filled: false,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FolderError) {
      const full = error.reason === "limit";
      return NextResponse.json(
        { error: full ? "This gallery has all the folders it can hold." : FOLDER_REFUSAL_MESSAGES[error.reason], code: full ? "event_full" : error.reason },
        { status: 409 },
      );
    }
    throw error;
  }
}
