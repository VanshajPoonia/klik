import { and, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { albums, events, media } from "./schema";
import { raisedBy } from "./db-errors";
import { descendantIds, folderPath, type FolderNode } from "./folder-tree";

/**
 * MED-4: folders, the database side. The tree's rules live in a trigger
 * (drizzle/0031_folders.sql) and its arithmetic in lib/folder-tree.ts; this is
 * the reading and writing, and turning the trigger's refusals into reasons.
 */

export type FolderRefusal = "cycle" | "too_deep" | "parent_invalid" | "limit" | "not_found" | "cover_invalid";

export class FolderError extends Error {
  constructor(public readonly reason: FolderRefusal) {
    super(reason);
  }
}

export const FOLDER_REFUSAL_MESSAGES: Record<FolderRefusal, string> = {
  cycle: "A folder cannot go inside itself or one of its own folders.",
  too_deep: "Folders go three levels deep at most.",
  parent_invalid: "That folder is not in this event any more.",
  limit: "This event has as many folders as its plan allows.",
  not_found: "That folder is not in this event any more.",
  cover_invalid: "Choose a photo from this event for the cover.",
};

/** Turns the trigger's raised names into the reason a person is shown. */
function translate(error: unknown): never {
  if (raisedBy(error, "album_cycle")) throw new FolderError("cycle");
  if (raisedBy(error, "album_too_deep")) throw new FolderError("too_deep");
  if (raisedBy(error, "album_parent_invalid")) throw new FolderError("parent_invalid");
  throw error;
}

export interface FolderRow extends FolderNode {
  createdAt: Date;
  coverMediaId: string | null;
}

const folderColumns = {
  id: albums.id,
  name: albums.name,
  parentId: albums.parentId,
  position: albums.position,
  coverMediaId: albums.coverMediaId,
  createdAt: albums.createdAt,
};

/** Every live manual folder in an event. Small: a plan allows dozens. */
export async function listFolders(eventId: string): Promise<FolderRow[]> {
  return db
    .select(folderColumns)
    .from(albums)
    .where(and(eq(albums.eventId, eventId), isNull(albums.deletedAt), eq(albums.kind, "manual")))
    .orderBy(albums.position, albums.createdAt);
}

async function liveFolder(eventId: string, id: string) {
  const [row] = await db
    .select({ id: albums.id })
    .from(albums)
    .where(and(eq(albums.id, id), eq(albums.eventId, eventId), isNull(albums.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** The position after the last live sibling, so a new or moved folder goes last. */
async function nextPosition(eventId: string, parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ last: max(albums.position) })
    .from(albums)
    .where(
      and(
        eq(albums.eventId, eventId),
        isNull(albums.deletedAt),
        parentId ? eq(albums.parentId, parentId) : isNull(albums.parentId),
      ),
    );
  return row?.last == null ? 0 : row.last + 1;
}

export async function createFolder({
  eventId,
  name,
  parentId,
  maxFolders,
}: {
  eventId: string;
  name: string;
  parentId: string | null;
  maxFolders: number;
}): Promise<FolderRow> {
  const live = await listFolders(eventId);
  if (live.length >= maxFolders) throw new FolderError("limit");
  if (parentId && !(await liveFolder(eventId, parentId))) throw new FolderError("parent_invalid");

  try {
    const [row] = await db
      .insert(albums)
      .values({ id: nanoid(), eventId, name, parentId, position: await nextPosition(eventId, parentId) })
      .returning(folderColumns);
    return row;
  } catch (error) {
    translate(error);
  }
}

export async function updateFolder(
  eventId: string,
  id: string,
  changes: { name?: string; parentId?: string | null; coverMediaId?: string | null },
): Promise<FolderRow> {
  if (!(await liveFolder(eventId, id))) throw new FolderError("not_found");
  const set: Partial<typeof albums.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.parentId !== undefined) {
    if (changes.parentId && !(await liveFolder(eventId, changes.parentId))) throw new FolderError("parent_invalid");
    set.parentId = changes.parentId;
    set.position = await nextPosition(eventId, changes.parentId);
  }
  if (changes.coverMediaId !== undefined) {
    if (changes.coverMediaId) {
      const [cover] = await db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.id, changes.coverMediaId), eq(media.eventId, eventId), isNull(media.deletedAt)))
        .limit(1);
      if (!cover) throw new FolderError("cover_invalid");
    }
    set.coverMediaId = changes.coverMediaId;
  }
  try {
    const [row] = await db
      .update(albums)
      .set(set)
      .where(and(eq(albums.id, id), eq(albums.eventId, eventId)))
      .returning(folderColumns);
    return row;
  } catch (error) {
    translate(error);
  }
}

/**
 * Puts one level's folders in the order given. Ids that are not live children
 * of `parentId` in this event match nothing, so a stale or forged list can
 * reorder only what it was allowed to see.
 */
export async function reorderFolders(eventId: string, parentId: string | null, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const cases = sql.join(
    ids.map((id, index) => sql`WHEN ${id} THEN ${index}::integer`),
    sql` `,
  );
  const rows = await db
    .update(albums)
    .set({ position: sql`CASE ${albums.id} ${cases} ELSE ${albums.position} END` })
    .where(
      and(
        eq(albums.eventId, eventId),
        inArray(albums.id, ids),
        isNull(albums.deletedAt),
        parentId ? eq(albums.parentId, parentId) : isNull(albums.parentId),
      ),
    )
    .returning({ id: albums.id });
  return rows.length;
}

/**
 * Trashes a folder and everything beneath it, with one timestamp, so restoring
 * the folder brings back exactly what went with it. Photos keep their folder,
 * and read as unfiled until it is restored.
 */
export async function deleteFolder(eventId: string, id: string): Promise<number> {
  const folders = await listFolders(eventId);
  if (!folders.some((folder) => folder.id === id)) return 0;
  const ids = [...descendantIds(folders, id)];
  const rows = await db
    .update(albums)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(albums.eventId, eventId), inArray(albums.id, ids), isNull(albums.deletedAt)))
    .returning({ id: albums.id });
  return rows.length;
}

/**
 * Folders in the trash, as the host deleted them: a subfolder that went with
 * its parent is part of that parent's entry, not one of its own.
 */
export async function trashedFolders(eventId: string) {
  const rows = await db
    .select({ id: albums.id, name: albums.name, parentId: albums.parentId, deletedAt: albums.deletedAt })
    .from(albums)
    .where(and(eq(albums.eventId, eventId), isNotNull(albums.deletedAt)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows
    .filter((row) => {
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      return !parent || parent.deletedAt?.getTime() !== row.deletedAt?.getTime();
    })
    .map((row) => ({
      ...row,
      folderCount: rows.filter((other) => other.deletedAt?.getTime() === row.deletedAt?.getTime() && isBeneath(rows, other.id, row.id)).length,
    }));
}

function isBeneath(rows: Array<{ id: string; parentId: string | null }>, id: string, ancestor: string): boolean {
  return descendantIds(
    rows.map((row) => ({ ...row, name: "", position: 0 })),
    ancestor,
  ).has(id);
}

/**
 * Restores folders from the trash: each one, what was trashed with it, and any
 * trashed folder above it, so it comes back somewhere it can be reached.
 */
export async function restoreFolders(eventId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .select({ id: albums.id, name: albums.name, parentId: albums.parentId, position: albums.position, deletedAt: albums.deletedAt })
    .from(albums)
    .where(eq(albums.eventId, eventId));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const restore = new Set<string>();
  for (const id of ids) {
    const folder = byId.get(id);
    if (!folder?.deletedAt) continue;
    const at = folder.deletedAt.getTime();
    for (const below of descendantIds(rows, id)) {
      if (byId.get(below)?.deletedAt?.getTime() === at) restore.add(below);
    }
    for (const above of folderPath(rows, id)) {
      if (above.deletedAt) restore.add(above.id);
    }
  }
  if (restore.size === 0) return 0;
  const restored = await db
    .update(albums)
    .set({ deletedAt: null })
    .where(and(eq(albums.eventId, eventId), inArray(albums.id, [...restore]), isNotNull(albums.deletedAt)))
    .returning({ id: albums.id });
  return restored.length;
}

/**
 * The folders a gallery shows, each marked `filled` when something a guest can
 * see is in it or anywhere beneath it. Tabs show only filled ones, because an
 * empty tab on a phone looks like a broken one; the upload picker shows them
 * all, because a host who made "Ceremony" before the ceremony wants guests to
 * put photos in it.
 */
export async function galleryFolders(eventId: string): Promise<Array<FolderRow & { filled: boolean }>> {
  const folders = await listFolders(eventId);
  if (folders.length === 0) return [];
  const filled = await db
    .selectDistinct({ albumId: media.albumId })
    .from(media)
    .where(
      and(
        eq(media.eventId, eventId),
        isNull(media.deletedAt),
        eq(media.status, "approved"),
        eq(media.visibility, "gallery"),
        isNotNull(media.albumId),
      ),
    );
  const keep = new Set<string>();
  for (const { albumId } of filled) {
    for (const folder of folderPath(folders, albumId)) keep.add(folder.id);
  }
  return folders.map((folder) => ({ ...folder, filled: keep.has(folder.id) }));
}

/** What a gallery page or its sync is sent: plain values, the team sees all. */
export interface GalleryFolder {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
  filled: boolean;
}

export async function galleryFolderPayload(eventId: string, { isManager }: { isManager: boolean }): Promise<GalleryFolder[]> {
  return (await galleryFolders(eventId)).map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    position: folder.position,
    createdAt: folder.createdAt.toISOString(),
    filled: isManager || folder.filled,
  }));
}

/**
 * Something about the folders changed that open galleries should hear about.
 * Phones resync on a moved `events.updated_at` and pick up the new folders.
 */
export async function touchEvent(eventId: string): Promise<void> {
  await db.update(events).set({ updatedAt: new Date() }).where(eq(events.id, eventId));
}
