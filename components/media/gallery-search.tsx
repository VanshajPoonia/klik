"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { LABEL_NAMES, type SceneLabel } from "@/lib/vision";
import type { GallerySearchPayload } from "@/lib/search";

/**
 * AI-2 and AI-4: the search box, the scene chips and the smart folders, for
 * the guest gallery and the dashboard alike. Each page decides how a result
 * becomes something on its grid (`toItems`): the guest gallery is sent whole
 * signed items, the dashboard ids of rows it already holds.
 */

export type SearchSelection =
  | { kind: "text"; q: string }
  | { kind: "scene"; label: SceneLabel }
  | { kind: "folder"; id: string; name: string };

export interface SearchCopy {
  search: string;
  searchLabel: string;
  searchGo: string;
  clearSearch: string;
  scenes: string;
  smartFolder: string;
  searchResults: (n: number) => string;
  searchFor: (query: string) => string;
  searchNothing: string;
  searchFailed: string;
  searchBusy: string;
  searching: string;
}

const EMPTY: GallerySearchPayload = { searchable: false, scenes: [], folders: [] };
/** Scenes fill in as photos are described, so the chips are asked for again now and then. */
const REFRESH_MS = 5 * 60 * 1000;

function queryString(selection: SearchSelection): string {
  if (selection.kind === "text") return `q=${encodeURIComponent(selection.q)}`;
  if (selection.kind === "scene") return `scene=${selection.label}`;
  return `folder=${encodeURIComponent(selection.id)}`;
}

export function useGallerySearch<T extends { id: string }>({
  endpoint,
  initial,
  toItems,
}: {
  /** `/api/e/<slug>/search` or `/api/events/<id>/search`. */
  endpoint: string;
  initial?: GallerySearchPayload | null;
  toItems: (json: unknown) => T[];
}) {
  const [payload, setPayload] = useState<GallerySearchPayload>(initial ?? EMPTY);
  const [selection, setSelection] = useState<SearchSelection | null>(null);
  const [results, setResults] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"failed" | "busy" | null>(null);
  // The answer to the newest question wins, however the network orders them.
  const ticket = useRef(0);
  const toItemsRef = useRef(toItems);
  useEffect(() => {
    toItemsRef.current = toItems;
  }, [toItems]);

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
    if (response?.ok) setPayload((await response.json()) as GallerySearchPayload);
  }, [endpoint]);

  useEffect(() => {
    // Asked at once when the page did not send it, then every few minutes
    // while the tab is visible.
    const first = initial ? null : window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => {
      if (first !== null) window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [initial, refresh]);

  const run = useCallback(
    async (next: SearchSelection) => {
      const mine = ++ticket.current;
      setSelection(next);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${endpoint}?${queryString(next)}`, { cache: "no-store" });
        if (mine !== ticket.current) return;
        if (!response.ok) {
          setResults([]);
          setError(response.status === 429 ? "busy" : "failed");
          return;
        }
        setResults(toItemsRef.current(await response.json()));
      } catch {
        if (mine === ticket.current) {
          setResults([]);
          setError("failed");
        }
      } finally {
        if (mine === ticket.current) setLoading(false);
      }
    },
    [endpoint],
  );

  const clear = useCallback(() => {
    ticket.current += 1;
    setSelection(null);
    setResults(null);
    setLoading(false);
    setError(null);
  }, []);

  /** Keeps open results honest as the gallery syncs: a photo hidden meanwhile leaves them. */
  const applyChanges = useCallback((upserts: T[], removed: string[]) => {
    if (upserts.length === 0 && removed.length === 0) return;
    const gone = new Set(removed);
    const fresh = new Map(upserts.map((item) => [item.id, item]));
    setResults((current) =>
      current ? current.filter((item) => !gone.has(item.id)).map((item) => fresh.get(item.id) ?? item) : current,
    );
  }, []);

  return { payload, setPayload, refresh, selection, results, loading, error, run, clear, applyChanges };
}

export type GallerySearchState<T extends { id: string }> = ReturnType<typeof useGallerySearch<T>>;

const chipClass = (pressed: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
    pressed ? "border-transparent bg-paper text-canvas" : "border-canvas-line text-muted hover:text-paper"
  }`;

export function GallerySearchBar<T extends { id: string }>({
  search,
  copy,
  locale = "en",
  actions,
  className = "mb-4",
}: {
  search: GallerySearchState<T>;
  copy: SearchCopy;
  locale?: "en" | "es";
  /** Shown beside the result count, for the dashboard's "save as smart folder". */
  actions?: ReactNode;
  className?: string;
}) {
  const { payload, selection, results, loading, error, run, clear } = search;
  const [text, setText] = useState("");
  const chips = payload.folders.length + payload.scenes.length;
  if (!payload.searchable && chips === 0) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = text.trim();
    if (q) void run({ kind: "text", q });
  };
  const reset = () => {
    setText("");
    clear();
  };

  const status = loading
    ? copy.searching
    : error === "busy"
      ? copy.searchBusy
      : error
        ? copy.searchFailed
        : results && results.length === 0
          ? copy.searchNothing
          : results
            ? `${copy.searchResults(results.length)}${selection?.kind === "text" ? ` ${copy.searchFor(selection.q)}` : ""}`
            : null;

  return (
    <div className={`space-y-2 ${className}`}>
      {payload.searchable && (
        <form role="search" onSubmit={submit} className="relative">
          <label htmlFor="gallery-search" className="sr-only">
            {copy.searchLabel}
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            id="gallery-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            maxLength={120}
            onChange={(event) => setText(event.target.value)}
            placeholder={copy.search}
            className="h-11 w-full rounded-full border border-canvas-line bg-canvas-raised pl-10 pr-12 text-sm text-paper placeholder:text-muted focus-visible:border-volt focus-visible:outline-none"
          />
          {(text || selection) && (
            <button
              type="button"
              onClick={reset}
              aria-label={copy.clearSearch}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </form>
      )}

      {chips > 0 && (
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={copy.scenes}>
          {payload.folders.map((folder) => {
            const pressed = selection?.kind === "folder" && selection.id === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                aria-pressed={pressed}
                title={copy.smartFolder}
                onClick={() => (pressed ? reset() : void run({ kind: "folder", id: folder.id, name: folder.name }))}
                className={chipClass(pressed)}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {folder.name}
              </button>
            );
          })}
          {payload.scenes.map((scene) => {
            const pressed = selection?.kind === "scene" && selection.label === scene.label;
            return (
              <button
                key={scene.label}
                type="button"
                aria-pressed={pressed}
                onClick={() => (pressed ? reset() : void run({ kind: "scene", label: scene.label }))}
                className={chipClass(pressed)}
              >
                {LABEL_NAMES[locale][scene.label]}
              </button>
            );
          })}
        </nav>
      )}

      {selection && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" role="status" aria-live="polite">
            {status}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-full px-3 text-sm text-paper underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
            >
              {copy.clearSearch}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
