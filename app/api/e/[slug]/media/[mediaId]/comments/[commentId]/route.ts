import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { resolveVisibleMedia } from "@/lib/media-viewer";
import { requireEventCapability } from "@/lib/roles";
import { deleteOwnComment, moderateComment } from "@/lib/comments";

type Params = Promise<{ slug: string; mediaId: string; commentId: string }>;

const patchSchema = z.object({ action: z.enum(["hide", "show"]) });

/**
 * MED-9: the team hides a comment, or shows one again. Needs `media.moderate`,
 * the same capability as approving photos, so a moderator co-host can do it
 * and a contributor cannot.
 */
export async function PATCH(request: Request, { params }: { params: Params }) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hide or show?" }, { status: 400 });

  const { slug, mediaId, commentId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await requireEventCapability(found.event.id, found.event.ownerId, "media.moderate");
  if (!actor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const outcome = await moderateComment({
    eventId: found.event.id,
    mediaId: found.item.id,
    commentId,
    action: parsed.data.action,
    byUserId: actor.session.user.id,
  });
  if (outcome === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (outcome === "klik_only") {
    return NextResponse.json(
      { error: "Klik is reviewing this one, so only Klik can show it again." },
      { status: 409 },
    );
  }

  await recordAudit({
    actor: actor.session,
    action: outcome === "hidden" ? "comment.hidden" : "comment.shown",
    targetType: "comment",
    targetId: commentId,
    eventId: found.event.id,
    detail:
      outcome === "hidden" ? "Hidden by the host." : outcome === "kept" ? "Kept by the host." : "Shown again by the host.",
  });
  return NextResponse.json({ ok: true });
}

/** The author takes their own comment down. Deleted outright: it is theirs. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { slug, mediaId, commentId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = found.managerUserId ?? (await auth())?.user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const deleted = await deleteOwnComment(commentId, found.item.id, userId);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
