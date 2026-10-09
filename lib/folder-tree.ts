/**
 * MED-4: folders as a tree. Pure, and safe to import in the browser, so the
 * dashboard, the guest gallery and the routes all agree on what "inside" means.
 *
 * Folders are the `albums` table, renamed for people and kept for code. Each
 * photo lives in one folder at most (`media.album_id`); a folder shows its own
 * photos and, when browsed from above, everything beneath it.
 */

/** Top level is depth 1. A trigger in drizzle/0031 enforces the same number. */
export const MAX_FOLDER_DEPTH = 3;

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  coverMediaId?: string | null;
  /** When it was made. Ties in `position` fall back to this, oldest first. */
  createdAt?: string | Date;
}

function byPosition(a: FolderNode, b: FolderNode): number {
  if (a.position !== b.position) return a.position - b.position;
  const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return timeA - timeB || (a.id < b.id ? -1 : 1);
}

/**
 * A folder's children, in order. A folder whose parent is missing (in the
 * trash, or gone) is treated as top level, so nothing ever becomes
 * unreachable because something above it was deleted.
 */
export function childrenOf<T extends FolderNode>(folders: T[], parentId: string | null): T[] {
  const ids = new Set(folders.map((folder) => folder.id));
  return folders
    .filter((folder) =>
      parentId === null
        ? folder.parentId === null || !ids.has(folder.parentId)
        : folder.parentId === parentId,
    )
    .sort(byPosition);
}

/** Root first, ending with the folder itself. Empty for an unknown id. */
export function folderPath<T extends FolderNode>(folders: T[], id: string | null): T[] {
  if (!id) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: T[] = [];
  const seen = new Set<string>();
  for (let at = byId.get(id); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    seen.add(at.id);
    path.unshift(at);
  }
  return path;
}

/** The folder and everything beneath it. */
export function descendantIds(folders: FolderNode[], id: string): Set<string> {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && found.has(folder.parentId) && !found.has(folder.id)) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

/** Levels in the subtree under and including this folder: 1 for a leaf. */
export function subtreeHeight(folders: FolderNode[], id: string): number {
  const kids = folders.filter((folder) => folder.parentId === id);
  return 1 + Math.max(0, ...kids.map((kid) => subtreeHeight(folders, kid.id)));
}

export type MoveRefusal = "self" | "cycle" | "too_deep" | "unknown_parent";

/**
 * Whether a folder may move under `parentId` (null is the top level). The
 * database trigger is what actually holds the line; this is so the dashboard
 * only offers moves that will work.
 */
export function canMoveFolder(folders: FolderNode[], id: string, parentId: string | null): MoveRefusal | null {
  if (parentId === null) return null;
  if (parentId === id) return "self";
  if (!folders.some((folder) => folder.id === parentId)) return "unknown_parent";
  if (descendantIds(folders, id).has(parentId)) return "cycle";
  const parentDepth = folderPath(folders, parentId).length;
  if (parentDepth + subtreeHeight(folders, id) > MAX_FOLDER_DEPTH) return "too_deep";
  return null;
}

/** Whether a new folder may be made inside this one. */
export function canNestIn(folders: FolderNode[], parentId: string | null): boolean {
  return parentId === null || folderPath(folders, parentId).length < MAX_FOLDER_DEPTH;
}

/**
 * Every folder in tree order with its depth, for a `<select>` that has to show
 * structure with indentation alone.
 */
export function flattenFolders<T extends FolderNode>(folders: T[]): Array<T & { depth: number }> {
  const out: Array<T & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf(folders, parentId)) {
      out.push({ ...folder, depth });
      if (depth < MAX_FOLDER_DEPTH + 2) walk(folder.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** "Ceremony / Vows", for anywhere a folder is named out of context. */
export function folderLabel(folders: FolderNode[], id: string): string {
  return folderPath(folders, id)
    .map((folder) => folder.name)
    .join(" / ");
}

/**
 * Items in a folder's subtree, or, for `null`, items in no live folder at all,
 * which is what "Unfiled" means: a photo whose folder is in the trash is
 * unfiled until the folder comes back.
 */
export function inFolder<T extends { albumId: string | null }>(
  items: T[],
  folders: FolderNode[],
  id: string | null,
  { deep = true }: { deep?: boolean } = {},
): T[] {
  if (id === null) {
    const live = new Set(folders.map((folder) => folder.id));
    return items.filter((item) => !item.albumId || !live.has(item.albumId));
  }
  const scope = deep ? descendantIds(folders, id) : new Set([id]);
  return items.filter((item) => item.albumId !== null && scope.has(item.albumId));
}
