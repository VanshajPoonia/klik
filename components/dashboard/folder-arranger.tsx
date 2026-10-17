"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { moveItem } from "@/lib/folder-order";
import type { DashboardMedia } from "@/components/dashboard/media-grid";

/**
 * MED-16: putting the photos filed in one folder in the order guests see
 * them. Dragged on a computer; the arrows under each do the same on a phone
 * and from a keyboard. Nothing changes for anyone until it is saved.
 */
export function FolderArranger({
  eventId,
  folder,
  items,
  onSaved,
  onClose,
}: {
  eventId: string;
  folder: { id: string; name: string };
  /** What is filed in this folder itself, in the order it is shown now. */
  items: DashboardMedia[];
  /** Each photo's new place, or null for "back to newest first". */
  onSaved: (positions: Record<string, number> | null) => void;
  onClose: () => void;
}) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const arranged = items.some((item) => item.folderPosition != null);
  const endpoint = `/api/events/${eventId}/albums/${folder.id}/order`;

  async function send(method: "PUT" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify({ ids: order.map((item) => item.id) }) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not save the order. Try again.");
        return;
      }
      onSaved(method === "PUT" ? data.positions : null);
      onClose();
    } catch {
      setError("Could not reach Klik. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="arrange-title" className="rounded-2xl border border-canvas-line bg-canvas-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 id="arrange-title" className="font-display text-lg text-paper">
            Arrange {folder.name}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Drag the photos into the order guests should see them, or use the arrows. It is the order in the
            gallery&rsquo;s folder tab and on a link to this folder. Photos filed here later go after these.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void send("PUT")}>
            {busy ? "Saving" : "Save this order"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {order.map((item, index) => (
          <li
            key={item.id}
            draggable={!busy}
            onDragStart={(drag) => {
              drag.dataTransfer.effectAllowed = "move";
              setDragging(index);
            }}
            onDragOver={(over) => {
              if (dragging === null) return;
              over.preventDefault();
              if (dragging !== index) {
                setOrder((current) => moveItem(current, dragging, index));
                setDragging(index);
              }
            }}
            onDragEnd={() => setDragging(null)}
            onDrop={(drop) => drop.preventDefault()}
            className={`overflow-hidden rounded-lg border bg-canvas transition-opacity ${
              dragging === index ? "border-volt opacity-60" : "border-canvas-line"
            }`}
          >
            <div className="relative aspect-square cursor-grab active:cursor-grabbing">
              <Image
                src={item.thumbSrc ?? `${item.blobUrl}?thumb=1`}
                alt=""
                fill
                unoptimized
                loading="lazy"
                sizes="160px"
                draggable={false}
                className="pointer-events-none object-cover"
              />
              {item.kind === "video" && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </span>
              )}
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {index + 1}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <IconButton
                label={`Move ${item.kind} ${index + 1} earlier`}
                disabled={busy || index === 0}
                onClick={() => setOrder((current) => moveItem(current, index, index - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`Move ${item.kind} ${index + 1} later`}
                disabled={busy || index === order.length - 1}
                onClick={() => setOrder((current) => moveItem(current, index, index + 1))}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>

      {arranged && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void send("DELETE")}
          className="mt-4 inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-2 transition-colors hover:text-paper disabled:opacity-50"
        >
          Back to newest first
        </button>
      )}
    </section>
  );
}
