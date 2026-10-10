import { and, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { getAppUrl } from "./env";
import {
  albums,
  events,
  media,
  mediaShareItems,
  mediaShares,
  type Album,
  type Event,
  type Media,
  type MediaShare,
} from "./schema";
import { descendantIds } from "./folder-tree";
import { listFolders } from "./folders";
import { decodeMediaCursor, encodeMediaCursor } from "./media-cursor";
import { rollUndeveloped } from "./media-access";
import { SHARE_SIGNING_WINDOW_MS, signMediaUrls } from "./media-urls";
import { SHARE_PAGE_SIZE, shareItemContentPath, type ManagedShare, type SharedItem } from "./share-access";

/**
 * Share links: the queries, the token, and the password.
 *
 * The rule for whether a link still opens lives in `lib/share-access.ts`, which
 * has no database and no environment so it can be imported by a client
 * component. This half needs both, so it stays server-only.
 */

/**
 * 22 characters of nanoid, so ~131 bits. Long enough that the token is the
 * whole security boundary, which it has to be: the URL carries no event slug
 * and no media id, and the lookup is by token alone, so there is nothing else
 * to check against.
 */
const SHARE_TOKEN_LENGTH = 22;

export function generateShareToken(): string {
  return nanoid(SHARE_TOKEN_LENGTH);
}

/**
 * Cost 10, matching gallery passwords rather than account credentials. A share
 * password is read aloud or pasted into a chat alongside the link; it guards one
 * photo, not an account that can delete a wedding.
 */
const SHARE_PASSWORD_COST = 10;

export function hashSharePassword(password: string): Promise<string> {
  return bcrypt.hash(password, SHARE_PASSWORD_COST);
}

export function verifySharePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function shareUrl(token: string): string {
  return `${getAppUrl()}/s/${token}`;
}

export interface ResolvedShare {
  share: MediaShare;
  event: Event;
  /** Null for a scope that does not point at a single photo. */
  item: Media | null;
  /** A folder link's folder, null once it is in the trash. */
  folder: Album | null;
}

/**
 * One round trip, by token alone.
 *
 * The event and media joins filter soft-deleted rows the same way the gallery
 * does, so a deleted photo takes its links with it without anybody having to
 * remember to revoke them. That one predicate also covers retention expiry and
 * purge for free: the purge cron soft-deletes media rather than destroying it,
 * so a link to a purged event resolves with a null item and refuses, with no
 * second rule to keep in step.
 */
export async function loadShareByToken(token: string): Promise<ResolvedShare | null> {
  const [row] = await db
    .select({ share: mediaShares, event: events, item: media, folder: albums })
    .from(mediaShares)
    // ADM-5: a gallery Klik has paused opens nothing through its links either.
    .innerJoin(events, and(eq(events.id, mediaShares.eventId), isNull(events.deletedAt), isNull(events.suspendedAt)))
    .leftJoin(media, and(eq(media.id, mediaShares.mediaId), isNull(media.deletedAt)))
    // A folder in the trash takes its links with it, the way a deleted photo
    // does, and brings them back if it is restored. Smart folders are worked
    // out by the machine and are never shared.
    .leftJoin(
      albums,
      and(
        eq(albums.id, mediaShares.albumId),
        eq(albums.eventId, mediaShares.eventId),
        eq(albums.kind, "manual"),
        isNull(albums.deletedAt),
      ),
    )
    .where(eq(mediaShares.token, token))
    .limit(1);

  return row ?? null;
}

/**
 * Whether what a link points at is still there: the photo, not deleted; the
 * folder, not in the trash. A selection is always "there"; its photos are
 * checked one by one. An event-wide link is allowed by the table and made by
 * nothing, so it opens nothing.
 */
export function shareTargetExists({ share, item, folder }: ResolvedShare): boolean {
  if (share.scope === "media") return item != null;
  if (share.scope === "album") return folder != null;
  return share.scope === "selection";
}

/**
 * Which photos a folder or selection link opens. One rule, used by the page,
 * the list it pages through, each photo's own routes and the ZIP, so none of
 * them can show a photo another would refuse.
 *
 * **A folder link is a window onto the folder.** It shows what is in the
 * folder and the folders inside it now, so photos filed there later appear
 * through it, and it follows the gallery's rules for what that is: approved,
 * and dark while a disposable roll has not developed. It also shows link-only
 * photos, because link-only means "reachable through a share link" and this is
 * one. Hidden photos stay hidden: hiding is the host saying "only us".
 *
 * **A selection is a set of photos the host picked one by one,** so like a
 * single-photo link it is the grant itself and does not consult visibility.
 * It still drops a photo that is later rejected or deleted.
 *
 * Neither ever shows a video whose location has not been cleaned yet (MED-8):
 * a link holder is never the person who filmed it.
 */
export async function collectionCondition(share: MediaShare, event: Event): Promise<SQL> {
  const live = and(
    eq(media.eventId, event.id),
    isNull(media.deletedAt),
    eq(media.status, "approved"),
    sql`NOT (${media.kind} = 'video' AND coalesce(${media.metadataState}, '') IN ('pending', 'failed'))`,
  )!;

  if (share.scope === "album" && share.albumId) {
    if (rollUndeveloped(event)) return sql`false`;
    const folders = await listFolders(event.id);
    if (!folders.some((folder) => folder.id === share.albumId)) return sql`false`;
    const ids = [...descendantIds(folders, share.albumId)];
    return and(live, inArray(media.albumId, ids), inArray(media.visibility, ["gallery", "link"]))!;
  }

  if (share.scope === "selection") {
    return and(
      live,
      inArray(
        media.id,
        db.select({ id: mediaShareItems.mediaId }).from(mediaShareItems).where(eq(mediaShareItems.shareId, share.id)),
      ),
    )!;
  }

  return sql`false`;
}

/**
 * One page of a folder or selection link's photos, newest first like the
 * gallery, and the cursor for the next page, null at the end.
 */
export async function listCollectionItems(
  share: MediaShare,
  event: Event,
  { cursor, limit = SHARE_PAGE_SIZE }: { cursor?: string | null; limit?: number } = {},
): Promise<{ items: Media[]; nextCursor: string | null }> {
  const conditions = [await collectionCondition(share, event)];
  const after = cursor ? decodeMediaCursor(cursor) : null;
  if (after) {
    conditions.push(
      after.id
        ? or(lt(media.createdAt, after.createdAt), and(eq(media.createdAt, after.createdAt), lt(media.id, after.id)))!
        : lt(media.createdAt, after.createdAt),
    );
  }
  const rows = await db
    .select()
    .from(media)
    .where(and(...conditions))
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeMediaCursor(items[items.length - 1]) : null };
}

/** How many photos a folder or selection link opens, and their total size. */
export async function collectionSummary(share: MediaShare, event: Event): Promise<{ count: number; bytes: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      bytes: sql<number>`coalesce(sum(${media.sizeBytes}), 0)`.mapWith(Number),
    })
    .from(media)
    .where(await collectionCondition(share, event));
  return row ?? { count: 0, bytes: 0 };
}

/** Every photo a folder or selection link opens, oldest first, for a ZIP. */
export async function allCollectionItems(share: MediaShare, event: Event): Promise<Media[]> {
  return db
    .select()
    .from(media)
    .where(await collectionCondition(share, event))
    .orderBy(media.createdAt, media.id);
}

/**
 * The photo a folder or selection link previews as in a chat: the folder's
 * cover if the link shows it, else the newest photo, else the newest video
 * with a poster still. A video without one has nothing to draw.
 */
export async function collectionPreviewItem(share: MediaShare, event: Event, coverId: string | null): Promise<Media | null> {
  const condition = await collectionCondition(share, event);
  const drawable = or(eq(media.kind, "photo"), sql`${media.posterPathname} IS NOT NULL`)!;
  if (coverId) {
    const [cover] = await db.select().from(media).where(and(eq(media.id, coverId), condition, drawable)).limit(1);
    if (cover) return cover;
  }
  const [newest] = await db
    .select()
    .from(media)
    .where(and(condition, drawable))
    .orderBy(sql`${media.kind} = 'photo' DESC`, desc(media.createdAt), desc(media.id))
    .limit(1);
  return newest ?? null;
}

/** A page of photos as the share page receives them. */
export async function toSharedItems(token: string, items: Media[], now = Date.now()): Promise<SharedItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const signed = await signMediaUrls(item, now, SHARE_SIGNING_WINDOW_MS);
      const blobUrl = shareItemContentPath(token, item.id);
      return {
        id: item.id,
        kind: item.kind,
        blobUrl,
        src: signed.src,
        thumbSrc: signed.thumbSrc,
        posterSrc: signed.posterSrc,
        posterUrl: item.posterPathname ? `${blobUrl}?poster=1` : null,
        durationS: item.durationS ?? null,
      };
    }),
  );
}

/** One photo, if this folder or selection link opens it. */
export async function collectionItem(share: MediaShare, event: Event, mediaId: string): Promise<Media | null> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), await collectionCondition(share, event)))
    .limit(1);
  return row ?? null;
}

/**
 * Spends one view against the cap, atomically.
 *
 * The cap has to be enforced inside the UPDATE. Reading `view_count` and writing
 * it back would let two concurrent opens of a one-view link both observe zero
 * and both pass, which is the exact case the cap exists to stop. `neon-http`
 * has no transactions, so a conditional `UPDATE ... RETURNING` is not merely the
 * tidy option, it is the only correct one available.
 *
 * Returns false when no row matched, meaning the link was revoked, expired or
 * already spent between the page rendering and this call.
 */
export async function countShareView(token: string): Promise<boolean> {
  const rows = await db
    .update(mediaShares)
    .set({ viewCount: sql`${mediaShares.viewCount} + 1` })
    .where(
      and(
        eq(mediaShares.token, token),
        isNull(mediaShares.revokedAt),
        or(isNull(mediaShares.expiresAt), gt(mediaShares.expiresAt, sql`now()`)),
        or(
          isNull(mediaShares.maxViews),
          sql`${mediaShares.viewCount} < ${mediaShares.maxViews}`,
        ),
      ),
    )
    .returning({ viewCount: mediaShares.viewCount });

  return rows.length > 0;
}

export interface CreateMediaShareInput {
  eventId: string;
  mediaId: string;
  createdByUserId: string;
  allowDownload?: boolean;
  expiresAt?: Date | null;
  maxViews?: number | null;
  password?: string | null;
}

export async function createMediaShare(input: CreateMediaShareInput): Promise<MediaShare> {
  const [row] = await db
    .insert(mediaShares)
    .values({
      id: nanoid(),
      token: generateShareToken(),
      eventId: input.eventId,
      mediaId: input.mediaId,
      scope: "media",
      createdByUserId: input.createdByUserId,
      allowDownload: input.allowDownload ?? false,
      expiresAt: input.expiresAt ?? null,
      maxViews: input.maxViews ?? null,
      passwordHash: input.password ? await hashSharePassword(input.password) : null,
    })
    .returning();

  return row;
}

export interface CreateCollectionShareInput {
  eventId: string;
  createdByUserId: string;
  /** A folder link. */
  albumId?: string;
  /** A selection link: photos already checked to be in this event. */
  mediaIds?: string[];
  allowDownload?: boolean;
  expiresAt?: Date | null;
  maxViews?: number | null;
  password?: string | null;
}

/**
 * A folder or selection link. `neon-http` has no transactions, so a selection
 * is written as the link and then its photos, and the link is removed by hand
 * if the photos fail to go in: a selection link with nothing in it would open
 * as "this link does not work" to whoever it was sent to.
 */
export async function createCollectionShare(input: CreateCollectionShareInput): Promise<MediaShare> {
  const selection = input.mediaIds ?? null;
  const [row] = await db
    .insert(mediaShares)
    .values({
      id: nanoid(),
      token: generateShareToken(),
      eventId: input.eventId,
      albumId: selection ? null : (input.albumId ?? null),
      scope: selection ? "selection" : "album",
      createdByUserId: input.createdByUserId,
      allowDownload: input.allowDownload ?? false,
      expiresAt: input.expiresAt ?? null,
      maxViews: input.maxViews ?? null,
      passwordHash: input.password ? await hashSharePassword(input.password) : null,
    })
    .returning();

  if (selection) {
    try {
      await db
        .insert(mediaShareItems)
        .values(selection.map((mediaId) => ({ shareId: row.id, mediaId })))
        .onConflictDoNothing();
    } catch (error) {
      await db.delete(mediaShares).where(eq(mediaShares.id, row.id));
      throw error;
    }
  }
  return row;
}

export type ShareListFilter = { mediaId: string } | { albumId: string } | undefined;

export interface ShareListRow {
  share: MediaShare;
  item: Media | null;
  albumName: string | null;
  itemCount: number | null;
  previewMediaId: string | null;
  previewKind: "photo" | "video" | null;
}

/**
 * Every link on an event, newest first, for the Links tab, or the links on one
 * photo or one folder for its share sheet.
 *
 * Returns revoked links too. An organizer looking at this screen is often
 * asking "did I turn that off?", and a list that silently drops revoked rows
 * answers by omission, which is indistinguishable from the link never having
 * existed.
 */
export async function listEventShares(eventId: string, filter?: ShareListFilter): Promise<ShareListRow[]> {
  const scope =
    filter && "mediaId" in filter
      ? and(eq(mediaShares.eventId, eventId), eq(mediaShares.mediaId, filter.mediaId))
      : filter && "albumId" in filter
        ? and(eq(mediaShares.eventId, eventId), eq(mediaShares.albumId, filter.albumId))
        : eq(mediaShares.eventId, eventId);

  const rows = await db
    .select({ share: mediaShares, item: media, albumName: albums.name })
    .from(mediaShares)
    .leftJoin(media, eq(media.id, mediaShares.mediaId))
    .leftJoin(albums, and(eq(albums.id, mediaShares.albumId), isNull(albums.deletedAt)))
    .where(scope)
    .orderBy(desc(mediaShares.createdAt));

  return withSelectionDetails(rows);
}

/** One link as its row in a list, after a change to it. */
export async function shareListRow(share: MediaShare): Promise<ShareListRow> {
  const [row] = await db
    .select({ item: media, albumName: albums.name })
    .from(mediaShares)
    .leftJoin(media, eq(media.id, mediaShares.mediaId))
    .leftJoin(albums, and(eq(albums.id, mediaShares.albumId), isNull(albums.deletedAt)))
    .where(eq(mediaShares.id, share.id))
    .limit(1);
  const [withDetails] = await withSelectionDetails([{ share, item: row?.item ?? null, albumName: row?.albumName ?? null }]);
  return withDetails;
}

/** How many photos each selection still holds, and the newest for a thumbnail. */
async function withSelectionDetails(
  rows: Array<{ share: MediaShare; item: Media | null; albumName: string | null }>,
): Promise<ShareListRow[]> {
  const selectionIds = rows.filter((row) => row.share.scope === "selection").map((row) => row.share.id);
  const details = new Map<string, { count: number; previewId: string | null; previewKind: "photo" | "video" | null }>();
  if (selectionIds.length > 0) {
    const counted = await db
      .select({
        shareId: mediaShareItems.shareId,
        count: sql<number>`count(*)`.mapWith(Number),
        previewId: sql<string | null>`(array_agg(${media.id} ORDER BY ${media.createdAt} DESC))[1]`,
        previewKind: sql<"photo" | "video" | null>`(array_agg(${media.kind} ORDER BY ${media.createdAt} DESC))[1]`,
      })
      .from(mediaShareItems)
      .innerJoin(media, and(eq(media.id, mediaShareItems.mediaId), isNull(media.deletedAt), eq(media.status, "approved")))
      .where(inArray(mediaShareItems.shareId, selectionIds))
      .groupBy(mediaShareItems.shareId);
    for (const row of counted) {
      details.set(row.shareId, { count: row.count, previewId: row.previewId, previewKind: row.previewKind });
    }
  }
  return rows.map((row) => {
    const detail = details.get(row.share.id);
    const selection = row.share.scope === "selection";
    return {
      ...row,
      itemCount: selection ? (detail?.count ?? 0) : null,
      previewMediaId: selection ? (detail?.previewId ?? null) : null,
      previewKind: selection ? (detail?.previewKind ?? null) : null,
    };
  });
}

/**
 * Turns a link off. Not a soft delete, and not idempotent-by-overwrite: the
 * first revocation's timestamp is kept, because "when did we turn this off" is
 * the question this column exists to answer.
 */
export async function revokeShare(shareId: string, eventId: string): Promise<boolean> {
  const rows = await db
    .update(mediaShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mediaShares.id, shareId),
        eq(mediaShares.eventId, eventId),
        isNull(mediaShares.revokedAt),
      ),
    )
    .returning({ id: mediaShares.id });

  return rows.length > 0;
}

/**
 * What an organizer's browser is allowed to know about a link.
 *
 * An allowlist, not a denylist, and `passwordHash` is the reason. A denylist
 * that forgets one field ships the hash to the client, and the last time this
 * codebase used a denylist for a public payload it leaked retention fields to
 * guests (SEC-10). Only whether a password is set is useful to the UI.
 */
export function toManagedShare(row: ShareListRow): ManagedShare {
  const { share, item } = row;
  return {
    id: share.id,
    token: share.token,
    url: shareUrl(share.token),
    scope: share.scope,
    mediaId: share.mediaId,
    mediaKind: item?.kind ?? null,
    albumId: share.albumId,
    albumName: row.albumName,
    itemCount: row.itemCount,
    previewMediaId: row.previewMediaId,
    previewKind: row.previewKind,
    allowDownload: share.allowDownload,
    hasPassword: share.passwordHash != null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxViews: share.maxViews,
    viewCount: share.viewCount,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
  };
}
