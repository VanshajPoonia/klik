import type { Media, MediaShare } from "./schema";

/**
 * The share-link rule, and the copy that explains it. No database, no
 * credentials, no environment: everything here is safe to import into a browser
 * bundle, which is why it is split from `lib/shares.ts` the same way
 * `lib/media-access.ts` is split from `lib/media.ts`.
 *
 * The gate is a pure function so it can be tested exhaustively, and so the page,
 * the OG image, the content redirect and the download cannot disagree about
 * whether a link is still live. That matters more here than it looks: the page
 * is seen by the recipient while the OG image is seen by everyone in the group
 * chat, so a disagreement between the two leaks a photo to strictly more people
 * than the link was ever sent to.
 *
 * Note what the gate deliberately does NOT consult: `media.visibility`. A host
 * who creates a link for a hidden photo has said, by that act, that this one
 * token may see it. The link *is* the grant, and `link` visibility exists
 * precisely to mean "out of the gallery, reachable only this way".
 */

export const MAX_SHARE_VIEWS = 10_000;

/**
 * The most photos one selection link may hold. A selection is picked by hand
 * in the dashboard, so this is far past anything a person means, and it keeps
 * one request from writing an unbounded list.
 */
export const MAX_SELECTION_SHARE_ITEMS = 500;

/** Photos a share page shows at once before it asks for more. */
export const SHARE_PAGE_SIZE = 60;

export type ShareDenial =
  /** No such token, or what it pointed at no longer exists. */
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  /** Real and live, but this viewer has not entered the password yet. */
  | "password";

export type ShareGate = { ok: true } | { ok: false; reason: ShareDenial };

/** The share fields the decision depends on, and nothing else. */
export type ShareGateFields = Pick<
  MediaShare,
  "revokedAt" | "expiresAt" | "maxViews" | "viewCount" | "passwordHash"
>;

/**
 * What this browser already established about this link: that it entered the
 * password, and that it has already been counted against the view cap.
 */
export interface ShareViewer {
  unlocked: boolean;
  counted: boolean;
}

/**
 * Whether this token opens, for this viewer, right now.
 *
 * Order is deliberate. Revocation is checked first and on every single request,
 * never from a cache, because it is the one hard control a host has after a link
 * has left their hands. Password is checked last so a revoked or expired link
 * says so plainly instead of asking for a password it will refuse anyway.
 */
export function evaluateShare(
  share: ShareGateFields,
  viewer: ShareViewer,
  now: Date = new Date(),
): ShareGate {
  if (share.revokedAt) return { ok: false, reason: "revoked" };
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  /**
   * The cap counts viewers, not page loads. A browser that already spent one of
   * the views keeps its access, because the alternative is that someone opens a
   * one-view link, spends the view, rotates their phone, and is locked out of
   * the photo they were just looking at by their own reload. Expiry and
   * revocation are checked above and still apply to them.
   */
  if (!viewer.counted && share.maxViews != null && share.viewCount >= share.maxViews) {
    return { ok: false, reason: "exhausted" };
  }
  if (share.passwordHash && !viewer.unlocked) return { ok: false, reason: "password" };
  return { ok: true };
}

/**
 * Copy for each refusal, held here so the page, the OG image and the API routes
 * say the same thing. Written for the person holding the link, who is usually a
 * guest at a party and not the person who revoked it.
 */
export const DENIAL_COPY: Record<ShareDenial, { title: string; detail: string }> = {
  not_found: {
    title: "This link does not work.",
    detail: "Check that you copied all of it, or ask whoever sent it for a new one.",
  },
  revoked: {
    title: "This link was turned off.",
    detail: "The person who shared the photo switched the link off. Ask them for a new one.",
  },
  expired: {
    title: "This link has expired.",
    detail: "It was set to stop working after a while. Ask for a fresh link.",
  },
  exhausted: {
    title: "This link has been opened too many times.",
    detail: "It was set to work for a limited number of views. Ask for a new one.",
  },
  password: {
    title: "This photo needs a password.",
    detail: "Whoever sent you the link can give you the password.",
  },
};

/**
 * The same refusals, worded for a link to several photos. Only the ones that
 * name what was shared differ; the rest read the same either way.
 */
const COLLECTION_DENIAL_COPY: Partial<Record<ShareDenial, { title: string; detail: string }>> = {
  revoked: {
    title: "This link was turned off.",
    detail: "The person who shared these photos switched the link off. Ask them for a new one.",
  },
  password: {
    title: "These photos need a password.",
    detail: "Whoever sent you the link can give you the password.",
  },
};

/** The copy for a refusal, for a link to one photo or to several. */
export function denialCopy(reason: ShareDenial, collection = false): { title: string; detail: string } {
  return (collection ? COLLECTION_DENIAL_COPY[reason] : undefined) ?? DENIAL_COPY[reason];
}

/** Whether a scope opens several photos rather than one. */
export function isCollectionScope(scope: string): scope is "album" | "selection" {
  return scope === "album" || scope === "selection";
}

/** HTTP status for a refusal. 410 for something that existed and stopped. */
export function denialStatus(reason: ShareDenial): number {
  switch (reason) {
    case "not_found":
      return 404;
    case "password":
      return 401;
    case "revoked":
    case "expired":
    case "exhausted":
      return 410;
    default:
      return 404;
  }
}

export function sharePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

export function shareContentPath(token: string): string {
  return `/api/s/${encodeURIComponent(token)}/content`;
}

export function shareDownloadPath(token: string): string {
  return `/api/s/${encodeURIComponent(token)}/download`;
}

/**
 * Where the photos behind a folder or selection link live, one route per
 * photo below it: `<base>/<id>/content` and `<base>/<id>/download`, the same
 * shape as the gallery's, so the gallery's viewer can open them as they are.
 */
export function shareItemsPath(token: string): string {
  return `/api/s/${encodeURIComponent(token)}/items`;
}

export function shareItemContentPath(token: string, mediaId: string): string {
  return `${shareItemsPath(token)}/${encodeURIComponent(mediaId)}/content`;
}

/** A ZIP of everything behind a folder or selection link, in parts. */
export function shareZipPath(token: string, part: number): string {
  return `/api/s/${encodeURIComponent(token)}/zip?part=${part}`;
}

/** What a ZIP of shared photos is called. Like a single download, it names
 *  neither the event nor the token. */
export function shareZipFilename(part: number, parts: number): string {
  return parts > 1 ? `klik-shared-photos-part-${part}-of-${parts}.zip` : "klik-shared-photos.zip";
}

/**
 * The name the file lands under.
 *
 * Shared by the download route and the viewer's own save-the-enhanced-bytes
 * path, so a photo keeps the same name whichever of the two produced it. Named
 * after nothing in particular on purpose: the token would be a copy of the grant
 * sitting in a filename, and the event name would put someone's wedding in a
 * stranger's downloads folder.
 */
export function shareDownloadFilename(item: Pick<Media, "id">, extension: string): string {
  return `klik-${item.id.slice(0, 8)}.${extension}`;
}

/**
 * One photo as a folder or selection link's page receives it: the routes that
 * re-check the link, and short-lived signed URLs so a page of tiles is not a
 * page of requests to us. Nothing about who took it.
 */
export interface SharedItem {
  id: string;
  kind: "photo" | "video";
  /** The authorized route: plays video, and is the fallback when a signature lapses. */
  blobUrl: string;
  src: string | null;
  thumbSrc: string | null;
  posterSrc: string | null;
  posterUrl: string | null;
  durationS: number | null;
}

/**
 * What an organizer's browser is allowed to know about a link.
 *
 * Timestamps are ISO strings rather than Dates, because that is what they
 * actually are once they have been through JSON. Typing them as Date would be a
 * lie the compiler then helpfully enforces, and the bug it produces is a
 * `getTime` on a string at the top of a render.
 */
export interface ManagedShare {
  id: string;
  token: string;
  url: string;
  scope: "media" | "album" | "event" | "selection";
  mediaId: string | null;
  mediaKind: "photo" | "video" | null;
  /** A folder link's folder, and its name while it is not in the trash. */
  albumId: string | null;
  albumName: string | null;
  /** A selection link: how many of its photos are still there. */
  itemCount: number | null;
  /** A selection link: one of its photos, for the list's thumbnail. */
  previewMediaId: string | null;
  previewKind: "photo" | "video" | null;
  allowDownload: boolean;
  /** Whether one is set. Never the hash. */
  hasPassword: boolean;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Whether a link is live, from the organizer's side.
 *
 * Deliberately a separate, coarser question from `evaluateShare`. That one
 * answers "may this request through" and needs the viewer's cookie; this one
 * answers "is this row still doing anything", which is what a list of links has
 * to show and can answer without a viewer at all.
 */
export function shareState(
  share: Pick<ManagedShare, "revokedAt" | "expiresAt" | "maxViews" | "viewCount">,
  now: Date = new Date(),
): "live" | "revoked" | "expired" | "exhausted" {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= now.getTime()) return "expired";
  if (share.maxViews != null && share.viewCount >= share.maxViews) return "exhausted";
  return "live";
}

/**
 * The expiry choices an organizer actually picks from.
 *
 * Presets rather than a date picker. The real question is "how long should this
 * stay open", and a calendar makes somebody answer it by doing arithmetic. The
 * server takes days for the same reason: a date computed in the browser is
 * computed in the browser's timezone and lands hours away from what was chosen.
 */
export const EXPIRY_OPTIONS = [
  { value: null, label: "Never expires" },
  { value: 1, label: "After 1 day" },
  { value: 7, label: "After 7 days" },
  { value: 30, label: "After 30 days" },
  { value: 365, label: "After a year" },
] as const;

/**
 * View caps. Capped at a number a host might plausibly mean rather than at the
 * column's limit, and labelled as "opens" because `max_views` counts browsers,
 * not page loads, and "views" invites the wrong mental model.
 */
export const VIEW_LIMIT_OPTIONS = [
  { value: null, label: "Unlimited opens" },
  { value: 1, label: "1 open" },
  { value: 5, label: "5 opens" },
  { value: 25, label: "25 opens" },
  { value: 100, label: "100 opens" },
] as const;
