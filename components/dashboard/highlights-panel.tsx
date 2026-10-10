"use client";

import { useMemo, type ReactNode } from "react";
import Image from "next/image";
import { Pin, PinOff, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardMedia } from "@/components/dashboard/media-grid";
import { HIGHLIGHT_COUNT, highlightsFor } from "@/lib/highlights";

type Highlight = "pinned" | "excluded" | null;

/**
 * AI-8: the photos that tell the story of the event, as a recap would send
 * them, with the host's word over the score: pin to keep one in, remove to
 * keep one out, and either can be taken back.
 */
export function HighlightsPanel({
  items,
  busy,
  onHighlight,
  onOpen,
}: {
  items: DashboardMedia[];
  busy: boolean;
  onHighlight: (ids: string[], highlight: Highlight) => void;
  onOpen: (id: string) => void;
}) {
  const selection = useMemo(() => highlightsFor(items), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const waiting = items.filter((item) => item.kind === "photo" && item.status === "approved" && !item.analyzedAt).length;
  const excluded = items.filter((item) => item.highlight === "excluded");
  const pinnedHidden = items.filter(
    (item) => item.highlight === "pinned" && (item.status !== "approved" || item.visibility !== "gallery"),
  );

  function tile(id: string, actions: ReactNode) {
    const item = byId.get(id);
    if (!item) return null;
    return (
      <li key={id} className="relative overflow-hidden rounded-xl bg-canvas-raised">
        <button
          type="button"
          onClick={() => onOpen(id)}
          aria-label={`View ${item.kind}`}
          className="relative block aspect-square w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt"
        >
          {item.thumbSrc || item.kind === "photo" ? (
            <Image
              src={item.thumbSrc ?? `${item.blobUrl}?thumb=1`}
              alt=""
              fill
              unoptimized
              loading="lazy"
              sizes="200px"
              className="object-cover"
            />
          ) : (
            <span className="block h-full w-full bg-canvas-line" />
          )}
          {item.highlight === "pinned" && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-volt px-2 py-0.5 text-[10px] font-medium text-on-volt">
              <Pin className="h-2.5 w-2.5" aria-hidden="true" />
              Pinned
            </span>
          )}
        </button>
        <div className="flex items-center justify-end gap-1 p-1.5">{actions}</div>
      </li>
    );
  }

  const action = (label: string, Icon: typeof Pin, ids: string[], highlight: Highlight) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onHighlight(ids, highlight)}
      className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs text-muted transition-colors hover:bg-canvas hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-volt" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-paper">Highlights</h2>
              <p className="mt-0.5 max-w-2xl text-xs text-muted">
                Up to {HIGHLIGHT_COUNT} photos that tell the story of the event, in the order they were taken. Picked
                for being sharp, well lit and loved by guests, and spread across the night so it is not one moment
                twenty times. Your choices always win: pin a photo to keep it in, remove one to keep it out. To pin
                any photo, select it in the gallery and choose Pin to highlights.
              </p>
            </div>
          </div>
        </div>
        {waiting > 0 && (
          <p className="text-xs text-muted" aria-live="polite">
            Still looking at {waiting} {waiting === 1 ? "photo" : "photos"}. They join in once measured, usually
            within a minute of arriving.
          </p>
        )}
        {selection.picks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-canvas-line px-4 py-10 text-center text-sm text-muted">
            Highlights appear here as photos arrive.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {selection.picks.map((id) =>
              tile(
                id,
                <>
                  {byId.get(id)?.highlight === "pinned"
                    ? action("Unpin", PinOff, [id], null)
                    : action("Pin", Pin, [id], "pinned")}
                  {action("Remove", X, [id], "excluded")}
                </>,
              ),
            )}
          </ul>
        )}
      </section>

      {selection.runnersUp.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-paper">Next in line</h2>
          <p className="text-xs text-muted">The best of the rest. Pinning one adds it to the highlights.</p>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {selection.runnersUp.map((id) => tile(id, action("Pin", Plus, [id], "pinned")))}
          </ul>
        </section>
      )}

      {pinnedHidden.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-paper">Pinned but hidden</h2>
          <p className="text-xs text-muted">
            Highlights go to guests, so a pinned photo that guests cannot see is left out until it is back in the
            gallery.
          </p>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {pinnedHidden.map((item) => tile(item.id, action("Unpin", PinOff, [item.id], null)))}
          </ul>
        </section>
      )}

      {excluded.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-paper">Kept out ({excluded.length})</h2>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onHighlight(excluded.map((item) => item.id), null)}
            >
              Allow them all again
            </Button>
          </div>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {excluded.map((item) => tile(item.id, action("Allow", Plus, [item.id], null)))}
          </ul>
        </section>
      )}
    </div>
  );
}
