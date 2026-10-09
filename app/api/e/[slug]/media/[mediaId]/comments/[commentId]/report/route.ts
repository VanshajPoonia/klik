import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { mediaComments } from "@/lib/schema";
import { resolveVisibleMedia } from "@/lib/media-viewer";
import { COMMENT_REPORT_REASONS, fileCommentReport } from "@/lib/comments";
import { clientIp, consume } from "@/lib/ratelimit";

const requestSchema = z.object({
  reason: z.enum(COMMENT_REPORT_REASONS),
  note: z.string().max(500).optional(),
});

/**
 * MED-9: a guest reports a comment. Only one they can see, never their own,
 * and not from the team, who hide it instead. Shares the photo reports' per
 * address limit, since it is the same person doing the same thing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string; commentId: string }> },
) {
  const ip = clientIp(request);
  const limit = await consume(`report:ip:${ip}`, 20, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reports from here. Try again later, or email us." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a reason" }, { status: 400 });

  const { slug, mediaId, commentId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found || !found.event.commentsEnabled) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found.isManager) {
    return NextResponse.json({ error: "You run this gallery, so hide it instead." }, { status: 400 });
  }

  // Visible ones only: a hidden comment is already down, and its id is not
  // something a guest should be able to probe for.
  const [comment] = await db
    .select({ id: mediaComments.id, userId: mediaComments.userId })
    .from(mediaComments)
    .where(
      and(
        eq(mediaComments.id, commentId),
        eq(mediaComments.mediaId, found.item.id),
        isNull(mediaComments.hiddenAt),
      ),
    )
    .limit(1);
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (await auth())?.user?.id ?? null;
  if (userId && comment.userId === userId) {
    return NextResponse.json({ error: "That one is yours. You can delete it instead." }, { status: 400 });
  }

  const result = await fileCommentReport({
    eventId: found.event.id,
    commentId,
    reason: parsed.data.reason,
    note: parsed.data.note,
    reporter: { guestId: found.guestId, userId, ip },
  });
  return NextResponse.json({ ok: true, hidden: result.hidden });
}
