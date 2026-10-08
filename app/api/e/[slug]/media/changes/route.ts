import { NextResponse } from "next/server";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { resolveEventViewer } from "@/lib/event-viewer";
import { canViewMedia } from "@/lib/media-access";
import { toGalleryMedia } from "@/lib/gallery-media";

/**
 * What changed in a gallery since a phone last asked.
 *
 * Replaces polling for new rows only, which had two problems. It was the
 * expensive keyset query on every poll from every phone, about 1,500 a minute
 * at a 200-guest wedding with nothing happening. And it only ever added: a
 * photo the host deleted, hid or rejected stayed on every phone until somebody
 * reloaded, which for the photo a host most wants gone is the worst case.
 *
 * Now the answer to "anything new?" comes from `events.media_changed_at`, which
 * a trigger keeps current, so a quiet gallery costs one event read per poll.
 * When something did change, the rows whose `changed_at` moved come back,
 * sorted into what this viewer may now see (`upserts`) and what they may not
 * (`removed`), using the same access rule as the grid and the content route.
 *
 * `at` is the database's own clock, so the next `since` is never skewed by the
 * function's. Rows are re-read across an overlap because a statement's
 * timestamp is taken when it starts and it may commit after a poll that ran in
 * between; re-sending a row is harmless, missing one is not.
 */

const OVERLAP_MS = 15_000;

/** Past this, a full first-page reload is cheaper and simpler than a delta. */
const MAX_CHANGES = 300;

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "since must be an ISO timestamp" }, { status: 400 });
  }

  const [row] = await db
    .select({ event: events, dbNow: sql<string>`now()` })
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const { event } = row;
  const at = new Date(row.dbNow).toISOString();

  const plan = await getAccountPlan(event.ownerId);
  const viewer = await resolveEventViewer(event, plan.galleryAccessDays);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: viewer.access.reason }, { status: 403, headers: noStore });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Join the gallery to view media" }, { status: 401, headers: noStore });
  }

  // A settings change can alter what this viewer may see without touching a
  // media row: moderation switched on, or a host turning off "uploaders see
  // their own hidden photos". Those stamp the event, so the phone starts over.
  if (event.updatedAt > since) {
    return NextResponse.json({ at, resync: true }, { headers: noStore });
  }

  const from = new Date(since.getTime() - OVERLAP_MS);
  if (event.mediaChangedAt <= from) {
    return NextResponse.json({ at, upserts: [], removed: [] }, { headers: noStore });
  }

  const changed = await db
    .select()
    .from(media)
    .where(and(eq(media.eventId, event.id), gt(media.changedAt, from)))
    .orderBy(asc(media.changedAt))
    .limit(MAX_CHANGES + 1);
  if (changed.length > MAX_CHANGES) {
    return NextResponse.json({ at, resync: true }, { headers: noStore });
  }

  const mediaViewer = { isManager: Boolean(viewer.ownerSession), guestId: viewer.guestId };
  const visible = changed.filter((item) => !item.deletedAt && canViewMedia(item, mediaViewer, event));
  const visibleIds = new Set(visible.map((item) => item.id));
  // Only rows the phone could already hold. A photo uploaded and hidden since
  // the last poll was never sent, so naming it would only announce that it
  // exists. Ids are opaque and the content route 404s them either way.
  const removed = changed
    .filter((item) => !visibleIds.has(item.id) && item.createdAt <= since)
    .map((item) => item.id);

  const upserts = await toGalleryMedia(
    visible.map((item) => ({ ...item, mine: viewer.guestId != null && item.guestId === viewer.guestId })),
    event.slug,
  );

  return NextResponse.json({ at, upserts, removed }, { headers: noStore });
}
