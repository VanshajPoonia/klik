import Image from "next/image";
import {
  Check,
  Download,
  EyeOff,
  Flag,
  Heart,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Play,
  Share2,
  ShieldAlert,
  Stamp,
  Trash2,
  X,
} from "lucide-react";
import type { Media, MediaVisibility } from "@/lib/schema";
import type { SignedMediaUrls } from "@/lib/media-urls";

/** A media row as the dashboard holds it: the row, plus the signed URLs the
 *  page issued. Optional, so a row updated from an API response still renders. */
export type DashboardMedia = Media & Partial<SignedMediaUrls> & {
  /** Open reports from guests (TRS-1). Absent or 0 when there are none. */
  openReports?: number;
  /** MED-10: a watermarked proof, and whether it is the viewer's own to release. */
  proof?: "mine" | "locked" | null;
};
import { VISIBILITY_OPTIONS } from "@/lib/media-access";
import { flattenFolders, type FolderNode } from "@/lib/folder-tree";

/** MED-4: what a drag of media carries, so drop targets ignore anything else. */
export const MEDIA_DRAG_TYPE = "application/x-klik-media";

/** Shown on the tile itself, because an organizer scanning a grid of two
 *  hundred photos should see which ones are hidden without opening each
 *  dropdown to find out. Gallery is the default and gets no badge: marking the
 *  normal case is noise. */
const VISIBILITY_BADGE: Partial<
  Record<MediaVisibility, { label: string; Icon: typeof EyeOff }>
> = {
  private: { label: "Hidden", Icon: EyeOff },
  link: { label: "Link only", Icon: Link2 },
};

export function MediaGrid({
  items,
  onApprove,
  onReject,
  onDelete,
  onOpen,
  selectionMode = false,
  selectedIds,
  onSelectionToggle,
  downloadBaseUrl,
  busyIds,
  albums,
  onAlbumChange,
  onVisibilityChange,
  onShare,
  onClearReports,
  dragIds,
  coverId,
  onSetCover,
}: {
  items: DashboardMedia[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionToggle?: (id: string) => void;
  downloadBaseUrl: string;
  busyIds?: Set<string>;
  albums?: FolderNode[];
  onAlbumChange?: (id: string, albumId: string | null) => void;
  onVisibilityChange?: (id: string, visibility: MediaVisibility) => void;
  onShare?: (id: string) => void;
  /** Closes the open reports on one photo after the host has looked. */
  onClearReports?: (id: string) => void;
  /** MED-4: what dragging this tile moves. Present makes tiles draggable. */
  dragIds?: (id: string) => string[];
  /** MED-4: the folder being browsed, and choosing its cover from it. */
  coverId?: string | null;
  onSetCover?: (id: string) => void;
}) {
  const folderOptions = albums ? flattenFolders(albums) : [];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => {
        const busy = busyIds?.has(item.id) ?? false;
        const selected = selectedIds?.has(item.id) ?? false;
        const selectionLabel = `${selected ? "Deselect" : "Select"} this ${item.kind}`;
        const badge = VISIBILITY_BADGE[item.visibility];

        return (
          <article
            key={item.id}
            className={`relative overflow-hidden rounded-xl border bg-canvas-raised transition ${
              selected ? "border-volt ring-2 ring-volt" : "border-canvas-line"
            }`}
            aria-busy={busy}
            draggable={Boolean(dragIds) && !busy}
            onDragStart={
              dragIds
                ? (event) => {
                    const ids = dragIds(item.id);
                    event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(ids));
                    event.dataTransfer.setData("text/plain", `${ids.length} item${ids.length === 1 ? "" : "s"}`);
                    event.dataTransfer.effectAllowed = "move";
                  }
                : undefined
            }
          >
            <button
              type="button"
              onClick={() =>
                selectionMode && onSelectionToggle
                  ? onSelectionToggle(item.id)
                  : onOpen(item.id)
              }
              className="relative block aspect-square w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt"
              aria-label={selectionMode ? selectionLabel : `View ${item.kind}`}
              aria-pressed={selectionMode ? selected : undefined}
            >
              {item.kind === "video" ? (
                <>
                  {/* The poster or its thumbnail where one exists. A <video
                      preload="metadata"> per tile reaches for the moov atom,
                      which on an iPhone .mov is at the end of the file. */}
                  {item.thumbSrc ? (
                    <Image
                      src={item.thumbSrc}
                      alt=""
                      fill
                      unoptimized
                      loading="lazy"
                      sizes="200px"
                      className="pointer-events-none object-cover"
                    />
                  ) : (
                    <video
                      src={item.blobUrl}
                      className="pointer-events-none h-full w-full object-cover"
                      muted
                      preload="metadata"
                    />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-paper">
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                </>
              ) : (
                <Image
                  src={item.thumbSrc ?? `${item.blobUrl}?thumb=1`}
                  alt=""
                  fill
                  unoptimized
                  loading="lazy"
                  sizes="200px"
                  className="object-cover"
                />
              )}
              {/* TRS-1. Above the visibility badge, because a report is the
                  thing on this tile that wants attention. A legal hold is
                  Klik's to handle, and says so, so a host does not wonder why
                  they cannot clear it. */}
              {!selectionMode && item.legalHoldAt ? (
                <span className="absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-1 text-[10px] font-medium text-paper">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  Held for review by Klik
                </span>
              ) : !selectionMode && item.openReports ? (
                <span className="absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-full bg-red-500/85 px-2 py-1 text-[10px] font-medium text-paper">
                  <Flag className="h-3 w-3" aria-hidden="true" />
                  Reported{item.openReports > 1 ? ` by ${item.openReports}` : ""}
                </span>
              ) : null}
              {badge && !selectionMode && (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-paper backdrop-blur">
                  <badge.Icon className="h-3 w-3" aria-hidden="true" />
                  {badge.label}
                </span>
              )}
              {/* MED-10. Under the visibility badge when there is one. */}
              {item.proof && !selectionMode && (
                <span
                  className={`absolute left-2 ${badge ? "top-9" : "top-2"} flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-paper backdrop-blur`}
                  title={item.proof === "mine" ? "Your proof. Guests see it watermarked until you release it." : "A watermarked proof. Only its photographer can release it."}
                >
                  <Stamp className="h-3 w-3" aria-hidden="true" />
                  {item.proof === "mine" ? "Your proof" : "Proof"}
                </span>
              )}
              {/* MED-9. What guests made of it, where the selection tick goes
                  when selecting, which is when it is not wanted. */}
              {!selectionMode && (item.reactionCount > 0 || item.commentCount > 0) && (
                <span className="absolute right-2 top-2 flex items-center gap-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium tabular-nums text-paper backdrop-blur">
                  {item.reactionCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" aria-hidden="true" />
                      {item.reactionCount}
                      <span className="sr-only">{item.reactionCount === 1 ? "heart" : "hearts"}</span>
                    </span>
                  )}
                  {item.commentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" aria-hidden="true" />
                      {item.commentCount}
                      <span className="sr-only">{item.commentCount === 1 ? "comment" : "comments"}</span>
                    </span>
                  )}
                </span>
              )}
              {selectionMode && (
                <>
                  <span
                    className={`absolute inset-0 transition-colors ${
                      selected ? "bg-volt/15" : "bg-black/5 hover:bg-black/15"
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                      selected
                        ? "border-volt bg-volt text-on-volt"
                        : "border-white bg-black/45 text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                </>
              )}
            </button>
            {!selectionMode && albums && albums.length > 0 && onAlbumChange && (
              <label className="block border-t border-canvas-line bg-canvas-raised px-2 py-2">
                <span className="sr-only">Folder for this {item.kind}</span>
                <select
                  value={item.albumId && folderOptions.some((folder) => folder.id === item.albumId) ? item.albumId : ""}
                  onChange={(event) => onAlbumChange(item.id, event.target.value || null)}
                  disabled={busy}
                  className="w-full rounded-lg border border-canvas-line bg-canvas px-2 py-1.5 text-xs text-paper"
                >
                  <option value="">No folder</option>
                  {folderOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {"\u00a0\u00a0\u00a0".repeat(folder.depth - 1)}
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!selectionMode && onVisibilityChange && (
              <label className="block border-t border-canvas-line bg-canvas-raised px-2 py-2">
                <span className="sr-only">Who can see this {item.kind}</span>
                <select
                  value={item.visibility}
                  onChange={(event) =>
                    onVisibilityChange(item.id, event.target.value as MediaVisibility)
                  }
                  disabled={busy}
                  className="w-full rounded-lg border border-canvas-line bg-canvas px-2 py-1.5 text-xs text-paper"
                >
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!selectionMode && onClearReports && Boolean(item.openReports) && !item.legalHoldAt && (
              <button
                type="button"
                onClick={() => onClearReports(item.id)}
                disabled={busy}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-canvas-line bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
                Looked at it, keep it
              </button>
            )}
            {!selectionMode && onSetCover && (
              <button
                type="button"
                onClick={() => onSetCover(item.id)}
                disabled={busy || coverId === item.id}
                aria-pressed={coverId === item.id}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-canvas-line bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas disabled:opacity-60"
              >
                <ImageIcon className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
                {coverId === item.id ? "Folder cover" : "Use as folder cover"}
              </button>
            )}
            {!selectionMode && onShare && (
              // Full width rather than another cell in the two-column grid, so
              // the actions below always come out even however many of them this
              // tile happens to have.
              <button
                type="button"
                onClick={() => onShare(item.id)}
                disabled={busy}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-canvas-line bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
                Share link
              </button>
            )}
            {!selectionMode && (
              <div className="grid grid-cols-2 gap-px bg-canvas-line">
                {onApprove && (
                  <button
                    type="button"
                    onClick={() => onApprove(item.id)}
                    disabled={busy}
                    className="flex min-h-11 items-center justify-center gap-1.5 bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
                    {item.status === "rejected" ? "Restore" : "Approve"}
                  </button>
                )}
                {onReject && (
                  <button
                    type="button"
                    onClick={() => onReject(item.id)}
                    disabled={busy}
                    className="flex min-h-11 items-center justify-center gap-1.5 bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    Reject
                  </button>
                )}
                <a
                  href={`${downloadBaseUrl}/${item.id}/download`}
                  className={`flex min-h-11 items-center justify-center gap-1.5 bg-canvas-raised px-2 text-xs text-paper transition-colors hover:bg-canvas ${
                    busy ? "pointer-events-none opacity-50" : ""
                  }`}
                  aria-label={`Download ${item.kind}`}
                >
                  <Download className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  disabled={busy}
                  className="flex min-h-11 items-center justify-center gap-1.5 bg-canvas-raised px-2 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
