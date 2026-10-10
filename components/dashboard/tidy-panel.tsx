"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { EyeOff, Pin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardMedia } from "@/components/dashboard/media-grid";
import { hiddenBy, tidyFor, type TidyGroup } from "@/lib/image-analysis";

/** The bulk route takes this many ids at a time. */
const CHUNK = 500;

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let start = 0; start < ids.length; start += CHUNK) out.push(ids.slice(start, start + CHUNK));
  return out;
}

const groupKey = (group: TidyGroup) => group.ids.join(",");
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * AI-7: copies, bursts and blurry photos, with exactly what would be hidden
 * shown before anything is. Hides, never deletes: a guest's photo called
 * blurry by arithmetic is not something to destroy, and the sharpest frame is
 * not always the one a person would keep, so any frame can be chosen instead.
 */
export function TidyPanel({
  items,
  busy,
  onVisibility,
  onOpen,
}: {
  items: DashboardMedia[];
  busy: boolean;
  /** Runs the bulk visibility change; resolves to the ids that changed. */
  onVisibility: (ids: string[], visibility: "private" | "gallery") => Promise<Set<string> | null>;
  onOpen: (id: string) => void;
}) {
  const plan = useMemo(() => tidyFor(items), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const pinned = useMemo(
    () => new Set(items.filter((item) => item.highlight === "pinned").map((item) => item.id)),
    [items],
  );
  const [open, setOpen] = useState(false);
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [spared, setSpared] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState<{ ids: string[]; label: string } | null>(null);

  const keeperOf = (group: TidyGroup) => {
    const chosen = keepers[groupKey(group)];
    return chosen && group.ids.includes(chosen) ? chosen : group.keep;
  };
  const similarHidden = plan.groups.flatMap((group) => hiddenBy(group, keeperOf(group), pinned));
  const blurryHidden = plan.blurry.filter((id) => !spared.has(id));

  if (!done && plan.groups.length === 0 && plan.blurry.length === 0) return null;

  async function hide(ids: string[], label: string) {
    const changed: string[] = [];
    for (const part of chunks(ids)) {
      const result = await onVisibility(part, "private");
      if (!result) break;
      changed.push(...result);
    }
    if (changed.length > 0) setDone({ ids: changed, label: `${label}. They are hidden from guests, not deleted.` });
  }

  async function undo() {
    if (!done) return;
    for (const part of chunks(done.ids)) {
      if (!(await onVisibility(part, "gallery"))) return;
    }
    setDone(null);
  }

  function thumb(id: string, state: "keep" | "hide", label: string, onClick: () => void) {
    const item = byId.get(id);
    if (!item) return null;
    const isPinned = pinned.has(id);
    return (
      <div key={id} className="relative w-20 shrink-0">
        <button
          type="button"
          onClick={onClick}
          aria-pressed={state === "keep"}
          aria-label={label}
          className={`relative block aspect-square w-20 overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
            state === "keep" ? "ring-2 ring-volt" : "opacity-55 hover:opacity-80"
          }`}
        >
          {item.thumbSrc || item.kind === "photo" ? (
            <Image
              src={item.thumbSrc ?? `${item.blobUrl}?thumb=1`}
              alt=""
              fill
              unoptimized
              loading="lazy"
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <span className="block h-full w-full bg-canvas-line" />
          )}
          <span
            className={`pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              state === "keep" ? "bg-volt text-on-volt" : "bg-black/70 text-paper"
            }`}
          >
            {isPinned ? (
              <Pin className="h-2.5 w-2.5" aria-hidden="true" />
            ) : state === "hide" ? (
              <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
            ) : null}
            {isPinned ? "Pinned" : state === "keep" ? "Keep" : "Hide"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpen(id)}
          className="mt-0.5 flex min-h-8 w-full items-center justify-center text-[11px] text-muted underline-offset-2 hover:text-paper hover:underline"
        >
          View
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-canvas-line bg-canvas-raised px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-volt" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-paper">Tidy up</p>
            <p className="mt-0.5 text-xs text-muted">
              {plan.groups.length === 0 && plan.blurry.length === 0
                ? "Nothing else to tidy."
                : `${[
                    plan.groups.length > 0 &&
                      `${plural(plan.groups.length, "set", "sets")} of repeats, with ${plural(similarHidden.length, "photo", "photos")} to hide`,
                    plan.blurry.length > 0 && `${plural(plan.blurry.length, "photo looks", "photos look")} blurry`,
                  ]
                    .filter(Boolean)
                    .join(", and ")}.`}
            </p>
          </div>
        </div>
        {(plan.groups.length > 0 || plan.blurry.length > 0) && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? "Close" : "Review"}
          </Button>
        )}
      </div>

      {done && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2 text-xs text-paper">
          <span>{done.label}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void undo()}>
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDone(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-6">
          {plan.groups.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-paper">Repeats</h3>
                  <p className="mt-0.5 max-w-xl text-xs text-muted">
                    The same file sent twice, and bursts of one moment. Each set keeps one photo: the first copy, or
                    the sharpest frame. Choose another to keep it instead. Pinned highlights are always kept.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busy || similarHidden.length === 0}
                  onClick={() => void hide(similarHidden, `Hid ${plural(similarHidden.length, "repeat", "repeats")}`)}
                >
                  Hide {plural(similarHidden.length, "photo", "photos")}
                </Button>
              </div>
              <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {plan.groups.map((group) => {
                  const keep = keeperOf(group);
                  return (
                    <li key={groupKey(group)} className="rounded-xl border border-canvas-line p-3">
                      <p className="mb-2 text-xs text-muted">
                        {group.exact ? `The same file, ${group.ids.length} times` : `${group.ids.length} similar shots`}
                      </p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {group.ids.map((id) => {
                          const kept = id === keep || pinned.has(id);
                          return (
                            thumb(id, kept ? "keep" : "hide", kept ? "Kept" : "Keep this one instead", () =>
                              setKeepers((current) => ({ ...current, [groupKey(group)]: id })),
                            )
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {plan.blurry.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-paper">Blurry</h3>
                  <p className="mt-0.5 max-w-xl text-xs text-muted">
                    Much softer than this event&apos;s usual photo. Tap any you want to keep.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busy || blurryHidden.length === 0}
                  onClick={() => void hide(blurryHidden, `Hid ${plural(blurryHidden.length, "blurry photo", "blurry photos")}`)}
                >
                  Hide {plural(blurryHidden.length, "photo", "photos")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {plan.blurry.map((id) => {
                  const keep = spared.has(id);
                  return (
                    thumb(id, keep ? "keep" : "hide", keep ? "Kept. Hide it after all" : "Keep this one", () =>
                      setSpared((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      }),
                    )
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
