import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, mediaShares, users } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { consume } from "@/lib/ratelimit";
import { recordAudit } from "@/lib/audit";
import { shareListRow, toManagedShare } from "@/lib/shares";
import {
  MAX_INVITES_PER_REQUEST,
  describeShareTarget,
  inviteRequestSchema,
  inviteToShare,
  listInvites,
  openToAnyone,
  parseInviteEmails,
  removeInvite,
} from "@/lib/share-invites";

/**
 * MED-14: the people a host's link is for. GET lists them, POST invites more
 * (and makes the link invite-only), DELETE takes one off, PATCH with
 * `inviteOnly: false` lets anyone holding the link open it again.
 */

async function load(eventId: string, shareId: string) {
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return null;
  const actor = await requireEventCapability(event.id, event.ownerId, "shares.manage");
  const [share] = await db
    .select()
    .from(mediaShares)
    .where(and(eq(mediaShares.id, shareId), eq(mediaShares.eventId, event.id)))
    .limit(1);
  if (!share) return null;
  return { event, actor, share };
}

type Params = { params: Promise<{ id: string; shareId: string }> };

async function payload(shareId: string) {
  const [share] = await db.select().from(mediaShares).where(eq(mediaShares.id, shareId)).limit(1);
  return { share: toManagedShare(await shareListRow(share)), invites: await listInvites(shareId) };
}

export async function GET(_request: Request, { params }: Params) {
  const { id, shareId } = await params;
  const loaded = await load(id, shareId);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!loaded.actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await payload(shareId));
}

export async function POST(request: Request, { params }: Params) {
  const { id, shareId } = await params;
  const loaded = await load(id, shareId);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!loaded.actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { event, actor, share } = loaded;
  if (share.revokedAt) {
    return NextResponse.json({ error: "This link was turned off. Make a new one to invite people." }, { status: 409 });
  }

  const parsed = inviteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type the addresses to invite" }, { status: 400 });
  const { valid, invalid } = parseInviteEmails(parsed.data.emails);
  if (valid.length === 0) {
    return NextResponse.json({ error: invalid.length ? "Those do not look like email addresses" : "Type the addresses to invite", invalid }, { status: 400 });
  }
  if (valid.length > MAX_INVITES_PER_REQUEST) {
    return NextResponse.json({ error: `Up to ${MAX_INVITES_PER_REQUEST} addresses at a time.` }, { status: 400 });
  }

  const limit = await consume(`share-invites:user:${actor.session.user.id}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "That is a lot of invitations for one hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const [inviter] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, actor.session.user.id))
    .limit(1);
  const row = await shareListRow(share);
  const result = await inviteToShare({
    share,
    event,
    emails: valid,
    invitedBy: { userId: actor.session.user.id },
    inviterName: inviter?.name || inviter?.username || event.name,
    what: describeShareTarget(row),
  });
  await recordAudit({
    actor: actor.session,
    action: "share.invited",
    targetType: "event",
    targetId: event.id,
    eventId: event.id,
    detail: `Invited ${result.sent.length + result.unsent.length} ${result.sent.length + result.unsent.length === 1 ? "person" : "people"} to link ${share.id}.`,
  });
  return NextResponse.json({ ...(await payload(shareId)), result, invalid });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, shareId } = await params;
  const loaded = await load(id, shareId);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!loaded.actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inviteId = new URL(request.url).searchParams.get("inviteId");
  if (!inviteId || !(await removeInvite(shareId, inviteId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await payload(shareId));
}

const patchSchema = z.object({ inviteOnly: z.literal(false) });

export async function PATCH(request: Request, { params }: Params) {
  const { id, shareId } = await params;
  const loaded = await load(id, shareId);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!loaded.actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!patchSchema.safeParse(await request.json().catch(() => null)).success) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  await openToAnyone(shareId);
  return NextResponse.json(await payload(shareId));
}
