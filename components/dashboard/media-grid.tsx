import Image from "next/image";
import { Check, Download, EyeOff, Link2, Play, Share2, Trash2, X } from "lucide-react";
import type { Media, MediaVisibility } from "@/lib/schema";
import { VISIBILITY_OPTIONS } from "@/lib/media-access";

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
}: {
  items: Media[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionToggle?: (id: string) => void;
  downloadBaseUrl: string;
  busyIds?: Set<string>;
  albums?: Array<{ id: string; name: string }>;
  onAlbumChange?: (id: string, albumId: string | null) => void;
  onVisibilityChange?: (id: string, visibility: MediaVisibility) => void;
  onShare?: (id: string) => void;
}) {
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
                  <video
                    src={item.blobUrl}
                    className="pointer-events-none h-full w-full object-cover"
                    muted
                    preload="metadata"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-paper">
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                </>
              ) : (
                <Image
                  src={item.blobUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="200px"
                  className="object-cover"
                />
              )}
              {badge && !selectionMode && (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-paper backdrop-blur">
                  <badge.Icon className="h-3 w-3" aria-hidden="true" />
                  {badge.label}
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
                <span className="sr-only">Album for this {item.kind}</span>
                <select
                  value={item.albumId ?? ""}
                  onChange={(event) => onAlbumChange(item.id, event.target.value || null)}
                  disabled={busy}
                  className="w-full rounded-lg border border-canvas-line bg-canvas px-2 py-1.5 text-xs text-paper"
                >
                  <option value="">Main gallery</option>
                  {albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.name}
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
