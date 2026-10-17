import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { guests, mediaShares } from "@/lib/schema";
import { guestFor } from "@/lib/guest-request";
import { clientIp, consume } from "@/lib/ratelimit";
import { shareListRow } from "@/lib/shares";
import {
  describeShareTarget,
  inviteRequestSchema,
  inviteToShare,
  listInvites,
  openToAnyone,
  parseInviteEmails,
  removeInvite,
} from "@/lib/share-invites";

/**
 * MED-14, a guest's half: the people one of their own links is for. Fewer at
 * a time than a host, because the mail goes out under Klik's name to
 * addresses a guest typed, and a gallery is not a mailing list.
 */
const GUEST_INVITES_PER_REQUEST = 10;

type Params = { params: Promise<{ slug: string; shareId: string }> };

async function load(slug: string, shareId: string) {
  const resolved = await guestFor(slug);
  if (!resolved.ok) return resolved;
  const [share] = await db
    .select()
    .from(mediaShares)
    .where(
      and(
        eq(mediaShares.id, shareId),
        eq(mediaShares.eventId, resolved.event.id),
        eq(mediaShares.createdByGuestId, resolved.guestId),
      ),
    )
    .limit(1);
  if (!share) return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { ...resolved, share };
}

async function payload(shareId: string) {
  const [share] = await db.select({ inviteOnly: mediaShares.inviteOnly }).from(mediaShares).where(eq(mediaShares.id, shareId)).limit(1);
  return { inviteOnly: Boolean(share?.inviteOnly), invites: await listInvites(shareId) };
}

export async function GET(_request: Request, { params }: Params) {
  const { slug, shareId } = await params;
  const loaded = await load(slug, shareId);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json(await payload(shareId));
}

export async function POST(request: Request, { params }: Params) {
  const { slug, shareId } = await params;
  const loaded = await load(slug, shareId);
  if (!loaded.ok) return loaded.response;
  const { event, guestId, share, viewer } = loaded;
  if (!viewer.access.allowed) return NextResponse.json({ error: "This gallery is not open right now." }, { status: 403 });
  if (share.revokedAt) return NextResponse.json({ error: "This link was turned off." }, { status: 409 });

  const parsed = inviteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type the addresses to invite", code: "no_addresses" }, { status: 400 });
  const { valid, invalid } = parseInviteEmails(parsed.data.emails);
  if (valid.length === 0) {
    return NextResponse.json({ error: "Type the addresses to invite", code: invalid.length ? "bad_addresses" : "no_addresses", invalid }, { status: 400 });
  }
  if (valid.length > GUEST_INVITES_PER_REQUEST) {
    return NextResponse.json({ error: `Up to ${GUEST_INVITES_PER_REQUEST} at a time`, code: "too_many" }, { status: 400 });
  }

  for (const [key, max] of [
    [`share-invites:guest:${guestId}`, 5],
    [`share-invites:ip:${clientIp(request)}`, 10],
  ] as const) {
    const limit = await consume(key, max, 60 * 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many invitations for now. Try again later.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  }

  const [guest] = await db.select({ name: guests.displayName }).from(guests).where(eq(guests.id, guestId)).limit(1);
  const row = await shareListRow(share);
  const result = await inviteToShare({
    share,
    event,
    emails: valid,
    invitedBy: { guestId },
    inviterName: guest?.name?.trim() || "A guest",
    what: describeShareTarget(row),
  });
  return NextResponse.json({ ...(await payload(shareId)), result, invalid });
}

export async function DELETE(request: Request, { params }: Params) {
  const { slug, shareId } = await params;
  const loaded = await load(slug, shareId);
  if (!loaded.ok) return loaded.response;
  const inviteId = new URL(request.url).searchParams.get("inviteId");
  if (!inviteId || !(await removeInvite(shareId, inviteId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await payload(shareId));
}

const patchSchema = z.object({ inviteOnly: z.literal(false) });

export async function PATCH(request: Request, { params }: Params) {
  const { slug, shareId } = await params;
  const loaded = await load(slug, shareId);
  if (!loaded.ok) return loaded.response;
  if (!patchSchema.safeParse(await request.json().catch(() => null)).success) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  await openToAnyone(shareId);
  return NextResponse.json(await payload(shareId));
}
