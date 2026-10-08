"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrashedMedia {
  id: string;
  kind: "photo" | "video";
  deletedAt: string;
  purgesAt: string;
  thumbUrl: string;
}

interface TrashedAlbum {
  id: string;
  name: string;
  purgesAt: string;
}

/**
 * SEC-4: the trash, which existed as an API with nothing on screen calling it.
 * Soft delete without a visible way back is just a slower delete, and the
 * support call it prevents is "a guest deleted my favourite photo".
 */
export function TrashPanel({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [media, setMedia] = useState<TrashedMedia[] | null>(null);
  const [albums, setAlbums] = useState<TrashedAlbum[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/events/${eventId}/trash`, { cache: "no-store" });
    if (!response.ok) {
      setMedia([]);
      return;
    }
    const body: { media: TrashedMedia[]; albums: TrashedAlbum[] } = await response.json();
    setMedia(body.media.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)));
    setAlbums(body.albums);
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function restore(payload: { mediaIds?: string[]; albumIds?: string[] }) {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/events/${eventId}/trash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error ?? "Could not restore that.");
      return;
    }
    const restored = (body.restoredMedia ?? 0) + (body.restoredAlbums ?? 0);
    setMessage(`Restored ${restored} ${restored === 1 ? "item" : "items"}. It is back in the gallery.`);
    setSelected(new Set());
    await load();
    // The gallery tab reads from the server render, so refresh it too.
    router.refresh();
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (media === null) return <p className="text-sm text-muted">Loading the trash…</p>;
  if (media.length === 0 && albums.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-canvas-line px-6 py-16 text-center text-sm text-muted">
        The trash is empty. Anything deleted from this gallery waits here for 30 days before it is
        removed for good.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-lg text-sm text-muted">
          Deleted items stay here for 30 days, then are removed for good. Select any to put them
          back exactly where they were.
        </p>
        {selected.size > 0 && (
          <Button size="sm" disabled={busy} onClick={() => void restore({ mediaIds: [...selected] })}>
            {busy ? "Restoring…" : `Restore ${selected.size}`}
          </Button>
        )}
      </div>
      {message && (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      )}

      {albums.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {albums.map((album) => (
            <li key={album.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm text-paper">
                Folder: {album.name}
                <span className="text-muted"> · removed for good {date(album.purgesAt)}</span>
              </p>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void restore({ albumIds: [album.id] })}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {media.map((item) => {
          const isSelected = selected.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${isSelected ? "Deselect" : "Select"} this ${item.kind}, removed for good ${date(item.purgesAt)}`}
              onClick={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              className={`relative aspect-square overflow-hidden rounded-xl border bg-canvas-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                isSelected ? "border-volt ring-2 ring-volt" : "border-canvas-line"
              }`}
            >
              <Image src={item.thumbUrl} alt="" fill unoptimized loading="lazy" sizes="200px" className="object-cover opacity-80" />
              {item.kind === "video" && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60">
                    <Play className="h-4 w-4 text-paper" aria-hidden="true" />
                  </span>
                </span>
              )}
              <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-paper">
                Gone {date(item.purgesAt)}
              </span>
              {isSelected && (
                <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-volt text-on-volt">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
