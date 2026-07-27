import Image from "next/image";
import { Check, Download, Play, Trash2, X } from "lucide-react";
import type { Media } from "@/lib/schema";

export function MediaGrid({
  items,
  onApprove,
  onReject,
  onDelete,
  onOpen,
  downloadBaseUrl,
  busyIds,
  albums,
  onAlbumChange,
}: {
  items: Media[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  downloadBaseUrl: string;
  busyIds?: Set<string>;
  albums?: Array<{ id: string; name: string }>;
  onAlbumChange?: (id: string, albumId: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => {
        const busy = busyIds?.has(item.id) ?? false;

        return (
          <article
            key={item.id}
            className="overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised"
            aria-busy={busy}
          >
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="relative block aspect-square w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt"
              aria-label={`View ${item.kind}`}
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
            </button>
            {albums && albums.length > 0 && onAlbumChange && (
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
          </article>
        );
      })}
    </div>
  );
}
