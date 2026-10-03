import { cache } from "react";
import { cookies } from "next/headers";
import { shareCookieName, verifyShareViewer, type ShareViewerState } from "./guest";
import { evaluateShare, type ShareDenial } from "./share-access";
import { loadShareByToken } from "./shares";
import type { Event, Media, MediaShare } from "./schema";

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
      item: Media;
      viewer: ShareViewerState;
    }
  | { ok: false; reason: ShareDenial; share: MediaShare | null };

export async function resolveShareRequest(token: string): Promise<ShareRequest> {
  const resolved = await loadShare(token);
  if (!resolved) return { ok: false, reason: "not_found", share: null };

  const { share, event, item } = resolved;

  // Null when the photo is soft-deleted, which also covers retention expiry and
  // purge. Checked before the gate so a link to a deleted photo reads as broken
  // rather than as revoked, since nobody revoked it.
  if (!item) return { ok: false, reason: "not_found", share };

  const cookieStore = await cookies();
  const raw = cookieStore.get(shareCookieName(share.id))?.value;
  const viewer = (raw ? await verifyShareViewer(raw, share.id) : null) ?? {
    shareId: share.id,
    unlocked: false,
    counted: false,
  };

  const gate = evaluateShare(share, viewer);
  if (!gate.ok) return { ok: false, reason: gate.reason, share };

  return { ok: true, share, event, item, viewer };
}
