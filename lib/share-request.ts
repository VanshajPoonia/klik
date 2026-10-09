import { cache } from "react";
import { cookies } from "next/headers";
import { shareCookieName, verifyShareViewer, type ShareViewerState } from "./guest";
import { evaluateShare, type ShareDenial } from "./share-access";
import { loadShareByToken, shareTargetExists } from "./shares";
import type { Album, Event, Media, MediaShare } from "./schema";

/**
 * Resolving a share token for one request: look it up, read this browser's
 * state for it, run the gate.
 *
 * Every public share surface goes through here, which is the point. The page,
 * the OG image, the content redirect and the download all have to reach the
 * same verdict, and the way they stop agreeing is one of them growing its own
 * copy of the rule. That already happened once in this codebase with
 * `media.visibility`, where the download route had quietly diverged.
 */

/**
 * Memoised for the duration of one request, so a page that renders the share and
 * also builds its OG metadata runs one query rather than two.
 */
export const loadShare = cache(loadShareByToken);

export type ShareRequest =
  | {
      ok: true;
      share: MediaShare;
      event: Event;
      /** The photo, for a link to one photo. */
      item: Media;
      folder: null;
      viewer: ShareViewerState;
    }
  | {
      ok: true;
      share: MediaShare;
      event: Event;
      /** Null: a folder or selection link opens several, through `lib/shares`. */
      item: null;
      /** The folder, for a folder link; null for a selection. */
      folder: Album | null;
      viewer: ShareViewerState;
    }
  | { ok: false; reason: ShareDenial; share: MediaShare | null };

export async function resolveShareRequest(token: string): Promise<ShareRequest> {
  const resolved = await loadShare(token);
  if (!resolved) return { ok: false, reason: "not_found", share: null };

  const { share, event, item, folder } = resolved;

  // A soft-deleted photo, which also covers retention expiry and purge, or a
  // folder in the trash. Checked before the gate so a link to something
  // deleted reads as broken rather than as revoked, since nobody revoked it.
  if (!shareTargetExists(resolved)) return { ok: false, reason: "not_found", share };

  const cookieStore = await cookies();
  const raw = cookieStore.get(shareCookieName(share.id))?.value;
  const viewer = (raw ? await verifyShareViewer(raw, share.id) : null) ?? {
    shareId: share.id,
    unlocked: false,
    counted: false,
  };

  const gate = evaluateShare(share, viewer);
  if (!gate.ok) return { ok: false, reason: gate.reason, share };

  if (share.scope === "media" && item) return { ok: true, share, event, item, folder: null, viewer };
  return { ok: true, share, event, item: null, folder: share.scope === "album" ? folder : null, viewer };
}

export type CollectionRequest = Extract<ShareRequest, { ok: true; item: null }>;

/**
 * The same, for the routes that serve a folder or selection link's photos.
 * A link to one photo opens nothing here: its photo has its own routes.
 */
export async function resolveCollectionRequest(
  token: string,
): Promise<CollectionRequest | { ok: false; reason: ShareDenial }> {
  const resolved = await resolveShareRequest(token);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  if (resolved.item) return { ok: false, reason: "not_found" };
  return resolved;
}
