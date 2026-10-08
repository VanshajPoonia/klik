/**
 * The client half of the gallery's change sync: folding what
 * `/api/e/[slug]/media/changes` returns into the list a phone already holds.
 * Pure and framework-free so it can be tested without a browser.
 */

export interface SyncedItem {
  id: string;
  /** Date over RSC, ISO string over JSON. */
  createdAt: string | Date;
  src?: string | null;
  thumbSrc?: string | null;
  posterSrc?: string | null;
}

/** Newest first, ties broken by id, matching the server's keyset order. */
export function compareNewestFirst(a: SyncedItem, b: SyncedItem): number {
  const timeA = new Date(a.createdAt).getTime();
  const timeB = new Date(b.createdAt).getTime();
  if (timeA !== timeB) return timeB - timeA;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Folds a batch of changes into the loaded list.
 *
 * Keeps the signed URLs an item already has, because a URL that changes is an
 * image the browser downloads again, and the one already on screen is fine. An
 * arrival older than everything loaded is left for "load more" while older
 * history remains, or it would appear at the bottom and then again in a page.
 */
export function mergeGalleryChanges<T extends SyncedItem>(
  current: T[],
  upserts: T[],
  removed: string[],
  hasOlderHistory: boolean,
): T[] {
  if (upserts.length === 0 && removed.length === 0) return current;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const id of removed) byId.delete(id);
  const oldestLoaded = current[current.length - 1];
  for (const incoming of upserts) {
    const existing = byId.get(incoming.id);
    if (existing) {
      byId.set(incoming.id, {
        ...incoming,
        src: existing.src ?? incoming.src,
        posterSrc: existing.posterSrc ?? incoming.posterSrc,
        // A thumbnail arriving later is worth switching to; a re-signed copy
        // of the same one is not.
        thumbSrc:
          existing.thumbSrc && existing.thumbSrc !== existing.src ? existing.thumbSrc : incoming.thumbSrc,
      });
    } else if (!hasOlderHistory || !oldestLoaded || compareNewestFirst(incoming, oldestLoaded) < 0) {
      byId.set(incoming.id, incoming);
    }
  }
  return [...byId.values()].sort(compareNewestFirst);
}
