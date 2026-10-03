import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, mediaShares } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { MAX_SHARE_VIEWS } from "@/lib/share-access";
import { hashSharePassword, revokeShare, toManagedShare } from "@/lib/shares";

/**
 * Every field is `.nullable().optional()`, which is the only way to tell "leave
 * this alone" from "clear it". Collapsing the two would mean a request that
 * changes the expiry silently strips the password, and a host would never find
 * out until the link was already open to anyone holding it.
 */
const patchSchema = z
  .object({
    allowDownload: z.boolean().optional(),
    expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
    maxViews: z.number().int().min(1).max(MAX_SHARE_VIEWS).nullable().optional(),
    password: z.string().min(4).max(200).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: "No changes provided" });

async function load(eventId: string, shareId: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return { event: null, actor: null, row: null };

  const actor = await requireEventCapability(event.id, event.ownerId, "shares.manage");

  // Scoped to the event as well as the id, so knowing a share id from one event
  // is not enough to touch it from another.
  const [row] = await db
    .select({ share: mediaShares, item: media })
    .from(mediaShares)
    .leftJoin(media, eq(media.id, mediaShares.mediaId))
    .where(and(eq(mediaShares.id, shareId), eq(mediaShares.eventId, event.id)))
    .limit(1);

  return { event, actor, row: row ?? null };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;
  const { event, actor, row } = await load(id, shareId);
  if (!event || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Revocation is final by design, so editing a revoked link has to be refused
  // rather than quietly reviving it. A host who wants it working again creates a
  // new one, which leaves the revocation on the record where it belongs.
  if (row.share.revokedAt) {
    return NextResponse.json(
      { error: "This link was turned off. Create a new one instead." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid share link settings" }, { status: 400 });
  }

  const changes: Partial<typeof mediaShares.$inferInsert> = {};
  if (parsed.data.allowDownload !== undefined) changes.allowDownload = parsed.data.allowDownload;
  if (parsed.data.expiresInDays !== undefined) {
    changes.expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
  }
  if (parsed.data.maxViews !== undefined) changes.maxViews = parsed.data.maxViews;
  if (parsed.data.password !== undefined) {
    changes.passwordHash = parsed.data.password
      ? await hashSharePassword(parsed.data.password)
      : null;
  }

  /**
   * Raising the cap resets the spent count, because an organizer who moves a
   * link from 5 views to 20 means "it should work 20 more times", not "it should
   * work 15 more times". Lowering it deliberately does not reset: that is
   * somebody tightening a link, and handing the views back would widen it.
   */
  if (
    changes.maxViews != null &&
    row.share.maxViews != null &&
    changes.maxViews > row.share.maxViews
  ) {
    changes.viewCount = 0;
  }

  const [updated] = await db
    .update(mediaShares)
    .set(changes)
    .where(eq(mediaShares.id, shareId))
    .returning();

  return NextResponse.json({ share: toManagedShare(updated, row.item) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;
  const { event, actor, row } = await load(id, shareId);
  if (!event || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await revokeShare(shareId, event.id);

  // Reports the revoked state either way, including for a link that was already
  // off. Revoking twice is not an error, and a host clicking it again because
  // they were not sure the first one landed should get agreement, not a 409.
  const [after] = await db.select().from(mediaShares).where(eq(mediaShares.id, shareId)).limit(1);
  return NextResponse.json({ share: toManagedShare(after, row.item) });
}
