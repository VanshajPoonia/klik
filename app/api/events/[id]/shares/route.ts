import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { consume, clientIp } from "@/lib/ratelimit";
import { MAX_SHARE_VIEWS } from "@/lib/share-access";
import { createMediaShare, listEventShares, toManagedShare } from "@/lib/shares";

/**
 * Creation is rate limited rather than capped at some total, because the thing
 * worth preventing is a stolen manager session minting links in a loop, and a
 * total cap answers that by locking the host out of their own feature once the
 * attacker has filled it. Generous enough that nobody sharing photos at a party
 * will ever see it.
 */
const SHARES_PER_HOUR = 120;

const createSchema = z.object({
  mediaId: z.string().min(10).max(64),
  allowDownload: z.boolean().default(false),
  /**
   * Days rather than a timestamp. The organizer is picking "a week", and having
   * the client compute a date means it computes it in the browser's timezone and
   * the server stores something an hour or a day off what was chosen.
   */
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
  maxViews: z.number().int().min(1).max(MAX_SHARE_VIEWS).nullable().default(null),
  password: z.string().min(4).max(200).nullable().default(null),
});

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

  // The share sheet for one photo asks for that photo's links; the Links tab
  // asks for all of them. Filtering in the query rather than in the browser
  // because an event that has been running for a week can have hundreds.
  const mediaId = new URL(request.url).searchParams.get("mediaId");
  const rows = await listEventShares(event.id, mediaId ?? undefined);
  return NextResponse.json({ shares: rows.map((row) => toManagedShare(row.share, row.item)) });
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

  // Scoped to this event, so a share cannot be minted for someone else's photo
  // by passing its id. Soft-deleted media is excluded: a link to a photo in the
  // trash would 404 the moment anyone opened it.
  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, parsed.data.mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const share = await createMediaShare({
    eventId: event.id,
    mediaId: item.id,
    createdByUserId: actor.session.user.id,
    allowDownload: parsed.data.allowDownload,
    expiresAt: parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
    maxViews: parsed.data.maxViews,
    password: parsed.data.password,
  });

  return NextResponse.json({ share: toManagedShare(share, item) }, { status: 201 });
}
