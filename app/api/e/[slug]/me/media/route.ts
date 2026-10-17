import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { albums, media } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { clientIp, consume } from "@/lib/ratelimit";

/**
 * MED-11: a guest arranging what they uploaded. Hide it from everyone but the
 * event's team, show it again, or move it into one of the host's folders. One
 * photo, a selection, or everything of theirs at once.
 *
 * Proved by the guest cookie, like deleting one's own upload (MED-6), and only
 * ever reaching rows whose `guest_id` is that guest's. "Show" undoes only the
 * guest's own hiding: `uploader_hidden` is cleared by a trigger whenever the
 * team sets a visibility, so a photo the host hid stays hidden.
 */

const schema = z
  .object({
    action: z.enum(["hide", "show", "move"]),
    ids: z.array(z.string().min(1).max(64)).min(1).max(500).optional(),
    /** Every upload of theirs in this gallery, instead of a list. */
    all: z.literal(true).optional(),
    /** For "move": a folder of this event, or null for none. */
    albumId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((body) => Boolean(body.ids) !== Boolean(body.all), { message: "Pick some photos, or all of yours" })
  .refine((body) => body.action !== "move" || body.albumId !== undefined, { message: "Pick a folder" });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const limit = await consume(`guest-arrange:ip:${clientIp(request)}`, 120, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many changes at once. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request" }, { status: 400 });
  }
  const { action, ids, albumId } = parsed.data;

  const viewer = await resolveEventViewer(event);
  if (!viewer.guestId) {
    return NextResponse.json({ error: "Join the gallery to manage your uploads" }, { status: 401 });
  }
  // VEN-2: a kiosk's uploads are everybody's who stood in front of it.
  if (viewer.kioskId) return NextResponse.json({ error: "A kiosk cannot do this." }, { status: 403 });
  // Hiding is always allowed, closed gallery or not: taking your own photo
  // out of view is never something to refuse. Showing and filing need the
  // gallery open, as anything else a guest does there does.
  if (action !== "hide" && !viewer.access.allowed) {
    return NextResponse.json({ error: "This gallery is not open right now." }, { status: 403 });
  }

  const mine: SQL = and(
    eq(media.eventId, event.id),
    eq(media.guestId, viewer.guestId),
    isNull(media.deletedAt),
    ids ? inArray(media.id, ids) : undefined,
  )!;

  let changed: Array<{ id: string }>;
  if (action === "hide") {
    changed = await db
      .update(media)
      .set({ visibility: "private", uploaderHidden: true })
      .where(and(mine, eq(media.visibility, "gallery")))
      .returning({ id: media.id });
  } else if (action === "show") {
    changed = await db
      .update(media)
      .set({ visibility: "gallery", uploaderHidden: false })
      .where(and(mine, eq(media.visibility, "private"), eq(media.uploaderHidden, true)))
      .returning({ id: media.id });
  } else {
    if (albumId) {
      const [folder] = await db
        .select({ id: albums.id })
        .from(albums)
        .where(and(eq(albums.id, albumId), eq(albums.eventId, event.id), eq(albums.kind, "manual"), isNull(albums.deletedAt)))
        .limit(1);
      if (!folder) return NextResponse.json({ error: "That folder is not in this gallery" }, { status: 404 });
    }
    changed = await db
      .update(media)
      .set({ albumId: albumId ?? null })
      .where(mine)
      .returning({ id: media.id });
  }

  return NextResponse.json({
    changed: changed.map((row) => row.id),
    // Theirs but left as it was: already hidden, hidden by the host, and so on.
    skipped: ids ? ids.filter((id) => !changed.some((row) => row.id === id)) : [],
  });
}
