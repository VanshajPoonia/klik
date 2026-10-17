import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { media, mediaShares, type Event } from "@/lib/schema";
import { resolveEventViewer } from "@/lib/event-viewer";
import { clientIp, consume } from "@/lib/ratelimit";
import { createCollectionShare, createMediaShare, hashSharePassword, shareUrl } from "@/lib/shares";

/**
 * MED-11: a guest sending a link to what they uploaded. One photo makes a
 * photo link and several make a selection, exactly as when the host does it,
 * through the same gate (lib/share-access.ts). Only their own uploads; the
 * host sees and can turn off every link on the Links tab, a guest's included.
 * A guest lists and turns off their own here, and can give one an end date
 * or a password (PATCH), the two limits a host's link has that matter to
 * someone sending their own photos to a few people.
 */

const createSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  allowDownload: z.boolean().default(true),
});

const limitSchema = z.object({
  id: z.string().min(1).max(64),
  // The ends a guest is offered: a day, a week, a month, or never.
  expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).nullable(),
  // The host's rule (app/api/events/[id]/shares): four characters at least.
  password: z.string().min(4).max(200).nullable(),
});

type GuestResolution =
  | { ok: false; response: NextResponse }
  | { ok: true; event: Event; viewer: Awaited<ReturnType<typeof resolveEventViewer>>; guestId: string };

async function guestFor(slug: string): Promise<GuestResolution> {
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const viewer = await resolveEventViewer(event);
  if (!viewer.guestId) {
    return { ok: false, response: NextResponse.json({ error: "Join the gallery to share your uploads" }, { status: 401 }) };
  }
  if (viewer.kioskId) return { ok: false, response: NextResponse.json({ error: "A kiosk cannot do this." }, { status: 403 }) };
  return { ok: true, event, viewer, guestId: viewer.guestId };
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await guestFor((await params).slug);
  if (!resolved.ok) return resolved.response;
  const rows = await db
    .select({
      id: mediaShares.id,
      token: mediaShares.token,
      scope: mediaShares.scope,
      createdAt: mediaShares.createdAt,
      revokedAt: mediaShares.revokedAt,
      expiresAt: mediaShares.expiresAt,
      locked: sql<boolean>`${mediaShares.passwordHash} IS NOT NULL`,
      count: sql<number>`CASE WHEN ${mediaShares.scope} = 'selection' THEN (SELECT count(*)::int FROM media_share_items WHERE share_id = ${mediaShares.id}) ELSE 1 END`,
    })
    .from(mediaShares)
    .where(and(eq(mediaShares.eventId, resolved.event.id), eq(mediaShares.createdByGuestId, resolved.guestId)))
    .orderBy(desc(mediaShares.createdAt))
    .limit(50);
  return NextResponse.json({
    links: rows.map((row) => ({
      id: row.id,
      url: shareUrl(row.token),
      count: row.count,
      createdAt: row.createdAt.toISOString(),
      off: Boolean(row.revokedAt),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      locked: row.locked,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limit = await consume(`guest-share:ip:${clientIp(request)}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many links at once. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const resolved = await guestFor((await params).slug);
  if (!resolved.ok) return resolved.response;
  if (!resolved.viewer.access.allowed) {
    return NextResponse.json({ error: "This gallery is not open right now." }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick what to share" }, { status: 400 });

  const ids = [...new Set(parsed.data.ids)];
  const own = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.eventId, resolved.event.id),
        eq(media.guestId, resolved.guestId),
        isNull(media.deletedAt),
        inArray(media.id, ids),
      ),
    );
  // Only their own: anything else is left out, as if it were not there.
  if (own.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const common = {
    eventId: resolved.event.id,
    createdByUserId: null,
    createdByGuestId: resolved.guestId,
    allowDownload: parsed.data.allowDownload,
  };
  const share =
    own.length === 1
      ? await createMediaShare({ ...common, mediaId: own[0].id })
      : await createCollectionShare({ ...common, mediaIds: own.map((row) => row.id) });
  return NextResponse.json(
    { id: share.id, url: shareUrl(share.token), count: own.length, skipped: ids.length - own.length },
    { status: 201 },
  );
}

/**
 * Sets both limits on one of the guest's own links, as chosen: an end a day,
 * a week or a month from now (or none), and a password (or none). It applies
 * to the link wherever it has already been sent, which is the point of doing
 * it after making the link rather than before.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limit = await consume(`guest-share:ip:${clientIp(request)}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many changes at once. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const resolved = await guestFor((await params).slug);
  if (!resolved.ok) return resolved.response;
  const parsed = limitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some((issue) => issue.path[0] === "password");
    return NextResponse.json(
      { error: tooShort ? "A password needs at least 4 characters" : "Check the link's limits", code: tooShort ? "password_short" : undefined },
      { status: 400 },
    );
  }
  const { id, expiresInDays, password } = parsed.data;
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const [updated] = await db
    .update(mediaShares)
    .set({ expiresAt, passwordHash: password ? await hashSharePassword(password) : null })
    .where(
      and(
        eq(mediaShares.id, id),
        eq(mediaShares.eventId, resolved.event.id),
        eq(mediaShares.createdByGuestId, resolved.guestId),
        isNull(mediaShares.revokedAt),
      ),
    )
    .returning({ id: mediaShares.id });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ expiresAt: expiresAt?.toISOString() ?? null, locked: Boolean(password) });
}

/** Turns off one of the guest's own links. Final, as for the host's. */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await guestFor((await params).slug);
  if (!resolved.ok) return resolved.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which link?" }, { status: 400 });
  const [revoked] = await db
    .update(mediaShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mediaShares.id, id),
        eq(mediaShares.eventId, resolved.event.id),
        eq(mediaShares.createdByGuestId, resolved.guestId),
        isNull(mediaShares.revokedAt),
      ),
    )
    .returning({ id: mediaShares.id });
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
