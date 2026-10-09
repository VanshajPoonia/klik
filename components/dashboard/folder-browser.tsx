"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Folder, FolderPlus, Link2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { MEDIA_DRAG_TYPE } from "@/components/dashboard/media-grid";
import {
  canMoveFolder,
  canNestIn,
  childrenOf,
  descendantIds,
  flattenFolders,
  folderPath,
  inFolder,
  type FolderNode,
} from "@/lib/folder-tree";

/** A folder as the dashboard holds it. */
export interface DashboardFolder extends FolderNode {
  coverMediaId: string | null;
}

/** "all", "unfiled", a folder's id, or `moment:` and a moment's id (AI-1). */
export type FolderView = "all" | "unfiled" | string;

export interface DashboardMoment {
  id: string;
  name: string;
}

export const momentView = (id: string): FolderView => `moment:${id}`;
export const viewedMoment = (view: FolderView): string | null => (view.startsWith("moment:") ? view.slice(7) : null);

interface BrowsableMedia {
  id: string;
  albumId: string | null;
  momentId?: string | null;
  kind: "photo" | "video";
  thumbSrc?: string | null;
  blobUrl: string;
}

function coverFor(folder: DashboardFolder, folders: DashboardFolder[], items: BrowsableMedia[]): BrowsableMedia | null {
  const inside = inFolder(items, folders, folder.id);
  return inside.find((item) => item.id === folder.coverMediaId) ?? inside[0] ?? null;
}

function hasMediaDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(MEDIA_DRAG_TYPE);
}

function readDrag(event: DragEvent): string[] {
  try {
    const ids = JSON.parse(event.dataTransfer.getData(MEDIA_DRAG_TYPE));
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * MED-4: the folders above the gallery grid. Browse by clicking, file by
 * dragging tiles onto a folder (or onto "Unfiled"), and, for whoever may
 * manage folders, make, rename, move, reorder and delete them. Moving many at
 * once is the selection bar's job; this is the place they go.
 */
export function FolderBrowser({
  eventId,
  folders,
  onFoldersChange,
  items,
  view,
  onViewChange,
  canManage,
  onDropMedia,
  moments = [],
  onMomentsChange,
  onShareFolder,
}: {
  eventId: string;
  folders: DashboardFolder[];
  onFoldersChange: (next: DashboardFolder[]) => void;
  /** Approved media, newest first: what counts and covers are drawn from. */
  items: BrowsableMedia[];
  view: FolderView;
  onViewChange: (view: FolderView) => void;
  canManage: boolean;
  onDropMedia: (ids: string[], folderId: string | null) => void;
  /** AI-1: the event's moments, worked out from capture times. */
  moments?: DashboardMoment[];
  onMomentsChange?: (next: DashboardMoment[]) => void;
  /** MED-2: opens the share sheet for a folder, for whoever may make links. */
  onShareFolder?: (folder: DashboardFolder) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /** Moving elsewhere closes whatever was half done here. */
  const go = (next: FolderView) => {
    setRenaming(false);
    setConfirmingDelete(false);
    setCreating(false);
    onViewChange(next);
  };

  const momentId = viewedMoment(view);
  const currentMoment = momentId ? (moments.find((moment) => moment.id === momentId) ?? null) : null;
  const current =
    view !== "all" && view !== "unfiled" && !momentId ? (folders.find((folder) => folder.id === view) ?? null) : null;
  const path = folderPath(folders, current?.id ?? null);
  const cards = view === "unfiled" || momentId ? [] : childrenOf(folders, current?.id ?? null);
  const unfiledCount = inFolder(items, folders, null).length;
  const nestable = view !== "unfiled" && !momentId && canNestIn(folders, current?.id ?? null);

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json" },
    }).catch(() => null);
    setBusy(false);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setError((body as { error?: string }).error ?? "That did not work. Try again.");
      return null;
    }
    return body as Record<string, unknown>;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const body = await call(`/api/events/${eventId}/albums`, {
      method: "POST",
      body: JSON.stringify({ name, parentId: current?.id ?? null }),
    });
    if (!body) return;
    onFoldersChange([...folders, body.album as DashboardFolder]);
    setNewName("");
    setCreating(false);
  }

  async function update(id: string, changes: Partial<Pick<DashboardFolder, "name" | "parentId" | "coverMediaId">>) {
    const body = await call(`/api/events/${eventId}/albums/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
    if (!body) return false;
    const album = body.album as DashboardFolder;
    onFoldersChange(folders.map((folder) => (folder.id === id ? { ...folder, ...album } : folder)));
    return true;
  }

  async function renameMoment(id: string, name: string) {
    const body = await call(`/api/events/${eventId}/albums/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    if (!body) return false;
    onMomentsChange?.(moments.map((moment) => (moment.id === id ? { ...moment, name } : moment)));
    return true;
  }

  async function remove(id: string) {
    const body = await call(`/api/events/${eventId}/albums/${id}`, { method: "DELETE" });
    if (!body) return;
    const gone = descendantIds(folders, id);
    const parent = folders.find((folder) => folder.id === id)?.parentId ?? null;
    onFoldersChange(folders.filter((folder) => !gone.has(folder.id)));
    setConfirmingDelete(false);
    go(parent ?? "all");
  }

  /** Swaps a card with its neighbour, on screen first and then on the server. */
  async function shift(id: string, by: -1 | 1) {
    const siblings = childrenOf(folders, current?.id ?? null);
    const index = siblings.findIndex((folder) => folder.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const order = siblings.map((folder) => folder.id);
    [order[index], order[target]] = [order[target], order[index]];
    const before = folders;
    onFoldersChange(
      folders.map((folder) => (order.includes(folder.id) ? { ...folder, position: order.indexOf(folder.id) } : folder)),
    );
    const body = await call(`/api/events/${eventId}/albums/reorder`, {
      method: "POST",
      body: JSON.stringify({ parentId: current?.id ?? null, ids: order }),
    });
    if (!body) onFoldersChange(before);
  }

  const dropProps = (folderId: string | null, key: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!hasMediaDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((target) => (target === key ? null : target)),
    onDrop: (event: DragEvent) => {
      if (!hasMediaDrag(event)) return;
      event.preventDefault();
      setDropTarget(null);
      const ids = readDrag(event);
      if (ids.length > 0) onDropMedia(ids, folderId);
    },
  });

  const crumb = (key: FolderView, label: string, active: boolean) => (
    <button
      type="button"
      onClick={() => go(key)}
      aria-current={active ? "page" : undefined}
      className={`min-h-10 rounded-full px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
        active ? "font-medium text-paper" : "text-muted hover:text-paper"
      }`}
    >
      {label}
    </button>
  );

  const moveTargets = current
    ? [
        { id: "", label: "Top level", ok: current.parentId !== null },
        ...flattenFolders(folders).map((folder) => ({
          id: folder.id,
          label: `${"   ".repeat(folder.depth - 1)}${folder.name}`,
          ok: folder.id !== current.parentId && canMoveFolder(folders, current.id, folder.id) === null,
        })),
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center">
          {crumb("all", "All media", view === "all")}
          {path.map((folder) => (
            <span key={folder.id} className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              {crumb(folder.id, folder.name, folder.id === view)}
            </span>
          ))}
          {currentMoment && (
            <span className="flex items-center">
              <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              {crumb(view, currentMoment.name, true)}
            </span>
          )}
        </nav>
        <button
          type="button"
          onClick={() => go(view === "unfiled" ? "all" : "unfiled")}
          aria-pressed={view === "unfiled"}
          {...(canManage ? dropProps(null, "unfiled") : {})}
          className={`min-h-10 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
            view === "unfiled" || dropTarget === "unfiled"
              ? "border-volt text-paper"
              : "border-canvas-line text-muted hover:text-paper"
          }`}
        >
          Unfiled ({unfiledCount})
        </button>
      </div>

      {moments.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Moments</p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Moments">
            {moments.map((moment) => {
              const count = items.filter((item) => item.momentId === moment.id).length;
              const pressed = moment.id === momentId;
              return (
                <button
                  key={moment.id}
                  type="button"
                  onClick={() => go(pressed ? "all" : momentView(moment.id))}
                  aria-pressed={pressed}
                  className={`min-h-10 shrink-0 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                    pressed ? "border-transparent bg-paper text-canvas" : "border-canvas-line text-muted hover:text-paper"
                  }`}
                >
                  {moment.name} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          {currentMoment && canManage && (
            renaming ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (rename.trim() && (await renameMoment(currentMoment.id, rename.trim()))) setRenaming(false);
                }}
              >
                <input
                  aria-label="Moment name"
                  className={`${inputClass} max-w-xs`}
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  maxLength={60}
                  autoFocus
                />
                <Button type="submit" size="sm" disabled={busy || !rename.trim()}>
                  Save
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRename(currentMoment.name);
                    setRenaming(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Rename moment
                </Button>
                <p className="text-xs text-muted">
                  Worked out from when photos were taken. Name it &ldquo;Ceremony&rdquo; or &ldquo;First dance&rdquo;
                  and the name stays as more arrive.
                </p>
              </div>
            )
          )}
        </div>
      )}

      {current && !canManage && onShareFolder && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onShareFolder(current)}>
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            Share link
          </Button>
        </div>
      )}

      {current && canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {renaming ? (
            <form
              className="flex flex-1 flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (rename.trim() && (await update(current.id, { name: rename.trim() }))) setRenaming(false);
              }}
            >
              <input
                aria-label="Folder name"
                className={`${inputClass} max-w-xs`}
                value={rename}
                onChange={(event) => setRename(event.target.value)}
                maxLength={60}
                autoFocus
              />
              <Button type="submit" size="sm" disabled={busy || !rename.trim()}>
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-paper">
                Delete {current.name}
                {childrenOf(folders, current.id).length > 0 ? " and the folders inside it" : ""}? Its photos stay
                in the gallery, unfiled, and the folder can be restored from the trash for 30 days.
              </p>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove(current.id)}>
                {busy ? "Deleting…" : "Delete folder"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <>
              {onShareFolder && (
                <Button variant="ghost" size="sm" onClick={() => onShareFolder(current)}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Share link
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRename(current.name);
                  setRenaming(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Rename
              </Button>
              <label className="flex items-center gap-2 text-sm text-muted">
                <span className="sr-only">Move this folder</span>
                <select
                  value="none"
                  disabled={busy}
                  onChange={(event) => {
                    const target = event.target.value;
                    if (target !== "none") void update(current.id, { parentId: target || null });
                  }}
                  className="min-h-10 rounded-full border border-canvas-line bg-canvas px-3 text-sm text-paper"
                >
                  <option value="none">Move to…</option>
                  {moveTargets.map((target) => (
                    <option key={target.id || "top"} value={target.id} disabled={!target.ok}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              {current.coverMediaId && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void update(current.id, { coverMediaId: null })}>
                  Use the newest photo as cover
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Button>
            </>
          )}
        </div>
      )}

      {(cards.length > 0 || (canManage && nestable)) && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((folder, index) => {
            const cover = coverFor(folder, folders, items);
            const count = inFolder(items, folders, folder.id).length;
            const highlighted = dropTarget === folder.id;
            return (
              <li key={folder.id} className="relative">
                <button
                  type="button"
                  onClick={() => go(folder.id)}
                  {...(canManage ? dropProps(folder.id, folder.id) : {})}
                  className={`group block w-full overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                    highlighted ? "border-volt ring-2 ring-volt" : "border-canvas-line hover:border-paper/30"
                  }`}
                >
                  <span className="relative flex aspect-[4/3] items-center justify-center bg-canvas-raised">
                    {cover ? (
                      <Image
                        src={cover.thumbSrc ?? `${cover.blobUrl}?thumb=1`}
                        alt=""
                        fill
                        unoptimized
                        loading="lazy"
                        sizes="200px"
                        className="object-cover"
                      />
                    ) : (
                      <Folder className="h-8 w-8 text-muted" aria-hidden="true" />
                    )}
                  </span>
                  <span className="block px-3 py-2">
                    <span className="block truncate text-sm font-medium text-paper">{folder.name}</span>
                    <span className="block text-xs text-muted">
                      {count} {count === 1 ? "item" : "items"}
                      {childrenOf(folders, folder.id).length > 0 &&
                        ` · ${childrenOf(folders, folder.id).length} ${childrenOf(folders, folder.id).length === 1 ? "folder" : "folders"}`}
                    </span>
                  </span>
                </button>
                {canManage && cards.length > 1 && (
                  <span className="absolute right-1.5 top-1.5 flex gap-1">
                    <IconButton
                      label={`Move ${folder.name} earlier`}
                      className="bg-black/60 text-paper"
                      onClick={() => void shift(folder.id, -1)}
                      disabled={busy || index === 0}
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`Move ${folder.name} later`}
                      className="bg-black/60 text-paper"
                      onClick={() => void shift(folder.id, 1)}
                      disabled={busy || index === cards.length - 1}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
          {canManage && nestable && (
            <li>
              {creating ? (
                <form onSubmit={create} className="flex h-full flex-col justify-center gap-2 rounded-xl border border-dashed border-canvas-line p-3">
                  <input
                    aria-label="New folder name"
                    className={inputClass}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={current ? "Inside this folder" : "Ceremony"}
                    maxLength={60}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
                      Add
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-canvas-line text-sm text-muted transition-colors hover:border-volt/50 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                >
                  <FolderPlus className="h-6 w-6" aria-hidden="true" />
                  {current ? `New folder in ${current.name}` : "New folder"}
                </button>
              )}
            </li>
          )}
        </ul>
      )}

      {canManage && cards.length > 0 && (
        <p className="text-xs text-muted">Drag photos onto a folder to file them, or onto Unfiled to take them out.</p>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
