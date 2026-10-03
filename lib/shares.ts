import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { getAppUrl } from "./env";
import { events, media, mediaShares, type Event, type Media, type MediaShare } from "./schema";
import type { ManagedShare } from "./share-access";

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
    .select({ share: mediaShares, event: events, item: media })
    .from(mediaShares)
    .innerJoin(events, and(eq(events.id, mediaShares.eventId), isNull(events.deletedAt)))
    .leftJoin(media, and(eq(media.id, mediaShares.mediaId), isNull(media.deletedAt)))
    .where(eq(mediaShares.token, token))
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

/**
 * Every link on an event, newest first, for the Links tab.
 *
 * Returns revoked links too. An organizer looking at this screen is often
 * asking "did I turn that off?", and a list that silently drops revoked rows
 * answers by omission, which is indistinguishable from the link never having
 * existed.
 */
export async function listEventShares(eventId: string, mediaId?: string) {
  const scope = mediaId
    ? and(eq(mediaShares.eventId, eventId), eq(mediaShares.mediaId, mediaId))
    : eq(mediaShares.eventId, eventId);

  return db
    .select({ share: mediaShares, item: media })
    .from(mediaShares)
    .leftJoin(media, eq(media.id, mediaShares.mediaId))
    .where(scope)
    .orderBy(desc(mediaShares.createdAt));
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
export function toManagedShare(share: MediaShare, item: Media | null): ManagedShare {
  return {
    id: share.id,
    token: share.token,
    url: shareUrl(share.token),
    scope: share.scope,
    mediaId: share.mediaId,
    mediaKind: item?.kind ?? null,
    allowDownload: share.allowDownload,
    hasPassword: share.passwordHash != null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    maxViews: share.maxViews,
    viewCount: share.viewCount,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
  };
}
