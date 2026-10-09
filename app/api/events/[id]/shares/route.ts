import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { consume, clientIp } from "@/lib/ratelimit";
import { MAX_SELECTION_SHARE_ITEMS, MAX_SHARE_VIEWS } from "@/lib/share-access";
import {
  createCollectionShare,
  createMediaShare,
  listEventShares,
  shareListRow,
  toManagedShare,
} from "@/lib/shares";

/**
 * Creation is rate limited rather than capped at some total, because the thing
 * worth preventing is a stolen manager session minting links in a loop, and a
 * total cap answers that by locking the host out of their own feature once the
 * attacker has filled it. Generous enough that nobody sharing photos at a party
 * will ever see it.
 */
const SHARES_PER_HOUR = 120;

const id = z.string().min(1).max(64);

/**
 * One of three targets: a photo, a folder (with the folders inside it), or a
 * selection of photos picked in the dashboard.
 */
const createSchema = z.object({
  mediaId: id.optional(),
  albumId: id.optional(),
  mediaIds: z.array(id).min(1).max(MAX_SELECTION_SHARE_ITEMS).optional(),
  allowDownload: z.boolean().default(false),
  /**
   * Days rather than a timestamp. The organizer is picking "a week", and having
   * the client compute a date means it computes it in the browser's timezone and
   * the server stores something an hour or a day off what was chosen.
   */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
  maxViews: z.number().int().min(1).max(MAX_SHARE_VIEWS).nullable().default(null),
  password: z.string().min(4).max(200).nullable().default(null),
}).refine(
  (input) => [input.mediaId, input.albumId, input.mediaIds].filter((target) => target !== undefined).length === 1,
  { message: "Share one photo, one folder or one selection" },
);

async function authorize(eventId: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return { event: null, actor: null };
  const actor = await requireEventCapability(event.id, event.ownerId, "shares.manage");
  return { event, actor };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await authorize(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The share sheet for one photo or folder asks for its links; the Links tab
  // asks for all of them. Filtering in the query rather than in the browser
  // because an event that has been running for a week can have hundreds.
  const search = new URL(request.url).searchParams;
  const mediaId = search.get("mediaId");
  const albumId = search.get("albumId");
  const rows = await listEventShares(
    event.id,
    mediaId ? { mediaId } : albumId ? { albumId } : undefined,
  );
  return NextResponse.json({ shares: rows.map(toManagedShare) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, actor } = await authorize(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid share link settings" }, { status: 400 });
  }

  const limit = await consume(`share:create:${event.id}:${clientIp(request)}`, SHARES_PER_HOUR, 3600);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many links created just now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const settings = {
    eventId: event.id,
    createdByUserId: actor.session.user.id,
    allowDownload: parsed.data.allowDownload,
    expiresAt: parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
    maxViews: parsed.data.maxViews,
    password: parsed.data.password,
  };

  if (parsed.data.albumId) {
    // A live folder the host made in this event. Smart folders are the
    // machine's grouping and are not shared.
    const [folder] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(
        and(
          eq(albums.id, parsed.data.albumId),
          eq(albums.eventId, event.id),
          eq(albums.kind, "manual"),
          isNull(albums.deletedAt),
        ),
      )
      .limit(1);
    if (!folder) return NextResponse.json({ error: "That folder is not in this event any more." }, { status: 404 });
    const share = await createCollectionShare({ ...settings, albumId: folder.id });
    return NextResponse.json({ share: toManagedShare(await shareListRow(share)) }, { status: 201 });
  }

  // Scoped to this event, so a share cannot be minted for someone else's photo
  // by passing its id. Soft-deleted media is excluded: a link to a photo in the
  // trash would 404 the moment anyone opened it. The selection is what the
  // dashboard's grid offers, which is the approved photos.
  const wanted = parsed.data.mediaIds ? [...new Set(parsed.data.mediaIds)] : [parsed.data.mediaId!];
  const found = await db
    .select()
    .from(media)
    .where(
      and(
        inArray(media.id, wanted),
        eq(media.eventId, event.id),
        isNull(media.deletedAt),
        ...(parsed.data.mediaIds ? [eq(media.status, "approved")] : []),
      ),
    );
  if (found.length === 0) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  if (found.length < wanted.length) {
    return NextResponse.json(
      { error: `${wanted.length - found.length} of those are not in the gallery any more. Select again and try once more.` },
      { status: 409 },
    );
  }

  // A selection of one is a link to that photo, which opens as the photo
  // rather than as a gallery of one.
  if (found.length === 1) {
    const share = await createMediaShare({ ...settings, mediaId: found[0].id });
    return NextResponse.json({ share: toManagedShare(await shareListRow(share)) }, { status: 201 });
  }

  const share = await createCollectionShare({ ...settings, mediaIds: found.map((item) => item.id) });
  return NextResponse.json({ share: toManagedShare(await shareListRow(share)) }, { status: 201 });
}
