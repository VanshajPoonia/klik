/**
 * MED-16: the order of the photos in a folder. Those the hosts placed come
 * first, smallest place first; the rest follow in the order they were already
 * in (the sort is stable), which is how new photos join an arranged folder.
 * The same rule orders a folder link's pages in SQL (lib/shares.ts), as
 * `coalesce(folder_position, UNPLACED)`.
 */
export const UNPLACED = 2_147_483_647;

export function folderRank(item: { folderPosition?: number | null }): number {
  return item.folderPosition ?? UNPLACED;
}

export function inFolderOrder<T extends { folderPosition?: number | null }>(items: T[]): T[] {
  if (!items.some((item) => item.folderPosition != null)) return items;
  return [...items].sort((a, b) => folderRank(a) - folderRank(b));
}

/** Moves one item to another index, for the arranger's drag and its arrows. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
