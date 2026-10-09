import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveVisibleMedia } from "@/lib/media-viewer";
import { addComment, cleanCommentBody, COMMENT_MAX_LENGTH, listComments } from "@/lib/comments";
import { clientIp, consume } from "@/lib/ratelimit";

const noStore = { "Cache-Control": "private, no-store" };

const postSchema = z.object({ body: z.string().max(COMMENT_MAX_LENGTH * 4) });

/** The account behind this request: the team member's, or a signed-in guest's. */
async function commenterId(managerUserId: string | null): Promise<string | null> {
  if (managerUserId) return managerUserId;
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * MED-9: one item's comments. Anyone who can see the item can read them while
 * the host has comments on. With comments off the team still can, so turning
 * them off is not also a way to lose track of what was said.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }) {
  const { slug, mediaId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (!found.event.commentsEnabled && !found.isManager) {
    return NextResponse.json({ error: "Comments are off for this gallery." }, { status: 403, headers: noStore });
  }

  const userId = await commenterId(found.managerUserId);
  const comments = await listComments({
    eventId: found.event.id,
    eventOwnerId: found.event.ownerId,
    mediaId: found.item.id,
    viewer: { userId, isManager: found.isManager },
  });
  return NextResponse.json({ comments, signedIn: Boolean(userId) }, { headers: noStore });
}

/**
 * Writing one needs an account (ACC-2's email code is enough), because free
 * text from anonymous strangers is a moderation queue the host did not sign up
 * to staff. Rate limited per account and per address.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }) {
  const ip = clientIp(request);
  const perIp = await consume(`comment:ip:${ip}`, 60, 60 * 60);
  if (!perIp.allowed) return tooMany(perIp.retryAfter);

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const { slug, mediaId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!found.event.commentsEnabled) {
    return NextResponse.json({ error: "Comments are off for this gallery." }, { status: 403 });
  }
  const userId = await commenterId(found.managerUserId);
  if (!userId) {
    return NextResponse.json({ error: "Sign in to comment.", signIn: true }, { status: 401 });
  }

  const body = cleanCommentBody(parsed.data.body);
  if (!body) {
    return NextResponse.json(
      {
        error: parsed.data.body.trim()
          ? `Keep it under ${COMMENT_MAX_LENGTH} characters.`
          : "Write something first.",
      },
      { status: 400 },
    );
  }

  const perPerson = await consume(`comment:user:${userId}`, 20, 10 * 60);
  if (!perPerson.allowed) return tooMany(perPerson.retryAfter);

  const comment = await addComment({
    eventId: found.event.id,
    eventOwnerId: found.event.ownerId,
    mediaId: found.item.id,
    userId,
    body,
    isManager: found.isManager,
  });
  return NextResponse.json({ comment }, { status: 201, headers: noStore });
}

function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "You are commenting faster than we can keep up with. Try again in a few minutes." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
