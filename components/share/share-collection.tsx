"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Play } from "lucide-react";
import { Lightbox } from "@/components/guest/lightbox";
import {
  VIEW_ENHANCE_FILTER,
  getEnhancePreference,
  getEnhancePreferenceOnServer,
  setEnhancePreference,
  subscribeEnhancePreference,
} from "@/lib/enhance-view";
import { formatDuration } from "@/lib/video-poster";
import { shareItemsPath, shareZipPath, type SharedItem } from "@/lib/share-access";

const photoCount = (count: number) => `${count} ${count === 1 ? "photo" : "photos"}`;

/** A tile that falls back to the route that re-checks the link once its signature lapses. */
function Tile({ primary, fallback, filter }: { primary: string; fallback: string; filter?: string }) {
  const [src, setSrc] = useState(primary);
  return (
    <Image
      src={src}
      alt=""
      fill
      unoptimized
      loading="lazy"
      sizes="(min-width: 768px) 25vw, 33vw"
      className="pointer-events-none object-cover"
      style={{ filter }}
      onError={() => {
        if (src !== fallback) setSrc(fallback);
      }}
    />
  );
}

/**
 * A folder or a selection behind a share link (MED-2, album and selection
 * scope): a grid that pages in as it scrolls, the gallery's own viewer, and
 * the downloads the host allowed.
 *
 * Like the single-photo page, the person here was sent this by someone and
 * very likely has never heard of Klik, so it is the photos, where they came
 * from, and one way out.
 */
export function ShareCollection({
  token,
  eventName,
  folderName,
  count,
  initialItems,
  initialCursor,
  canDownload,
  zipParts,
  undeveloped,
  galleryUrl,
}: {
  token: string;
  eventName: string;
  /** A folder link's folder; null for a selection. */
  folderName: string | null;
  count: number;
  initialItems: SharedItem[];
  initialCursor: string | null;
  canDownload: boolean;
  /** How many ZIP files everything comes in, 0 when downloads are off. */
  zipParts: number;
  /** A folder of a disposable roll that has not developed. */
  undeveloped: boolean;
  galleryUrl: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const enhanced = useSyncExternalStore(
    subscribeEnhancePreference,
    getEnhancePreference,
    getEnhancePreferenceOnServer,
  );

  // Counts the view once, after the page has loaded, as the single-photo page
  // does: a chat app drawing a preview never runs this, so it never spends an
  // open of a limited link.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    void fetch(`/api/s/${token}/view`, { method: "POST" }).then((response) => {
      if (response.status === 410) router.refresh();
    });
  }, [router, token]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`${shareItemsPath(token)}?cursor=${encodeURIComponent(cursor)}`);
      // Turned off, expired or locked since the page loaded: the server page
      // says which.
      if (response.status === 401 || response.status === 404 || response.status === 410) {
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error();
      const page = (await response.json()) as { items: SharedItem[]; nextCursor: string | null };
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setLoadError("More photos did not load. Check your connection.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, router, token]);

  // The next page loads as the end of the grid comes near.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || loadError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loadError, loadMore]);

  const openIndex = openId ? items.findIndex((item) => item.id === openId) : -1;
  const gridFilter = enhanced ? VIEW_ENHANCE_FILTER : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-6 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">{eventName}</p>
          <h1 className="mt-1 font-display text-2xl text-paper sm:text-3xl">{folderName ?? photoCount(count)}</h1>
          <p className="mt-1 text-xs text-muted">
            Shared with you{folderName && count > 0 ? ` · ${photoCount(count)}` : ""}
          </p>
        </div>
        {canDownload && zipParts > 0 && (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: zipParts }, (_, index) => (
              <a
                key={index}
                href={shareZipPath(token, index + 1)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {zipParts === 1 ? "Download all" : `Part ${index + 1} of ${zipParts}`}
              </a>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 px-4 sm:px-6">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-canvas-line px-6 py-16 text-center">
            <p className="font-medium text-paper">
              {undeveloped ? "These photos have not developed yet" : "Nothing here yet"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {undeveloped
                ? "They appear here once the roll develops. Come back to this link then."
                : "Photos added to this folder appear here. Come back to this link later."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3 md:grid-cols-4">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setOpenId(item.id)}
                aria-label={item.kind === "video" ? "Open video" : "Open photo"}
                className="relative aspect-square overflow-hidden rounded-lg border border-canvas-line bg-canvas-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt sm:rounded-xl"
              >
                {item.thumbSrc || item.posterUrl ? (
                  <Tile
                    key={item.thumbSrc ?? item.posterUrl!}
                    primary={item.thumbSrc ?? item.posterUrl!}
                    fallback={`${item.blobUrl}?thumb=1`}
                    filter={gridFilter}
                  />
                ) : item.kind === "photo" ? (
                  <Tile key={item.blobUrl} primary={`${item.blobUrl}?thumb=1`} fallback={item.blobUrl} filter={gridFilter} />
                ) : (
                  <video src={item.blobUrl} className="pointer-events-none h-full w-full object-cover" muted preload="metadata" />
                )}
                {item.kind === "video" && (
                  <>
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                        <Play className="h-4 w-4 text-paper" aria-hidden="true" />
                      </span>
                    </span>
                    {item.durationS ? (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-paper backdrop-blur">
                        {formatDuration(item.durationS)}
                      </span>
                    ) : null}
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        <div ref={sentinel} aria-hidden="true" />
        {(loading || loadError) && (
          <div className="py-6 text-center text-sm text-muted" role="status">
            {loadError ? (
              <button type="button" onClick={() => void loadMore()} className="min-h-11 text-volt hover:text-paper">
                {loadError} Try again.
              </button>
            ) : (
              "Loading more…"
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 py-8 text-center sm:px-6">
        {galleryUrl ? (
          <Link
            href={galleryUrl}
            className="inline-flex min-h-11 items-center rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            See the full gallery
          </Link>
        ) : (
          <Link href="/" className="text-xs text-muted transition-colors hover:text-paper">
            Shared with Klik
          </Link>
        )}
      </footer>

      {openIndex >= 0 && (
        <Lightbox
          items={items}
          index={openIndex}
          onIndexChange={(next) => {
            setOpenId(items[next]?.id ?? null);
            // Swiping toward the end of what has loaded fetches the rest.
            if (next >= items.length - 3) void loadMore();
          }}
          onClose={() => setOpenId(null)}
          canDownload={canDownload}
          downloadBaseUrl={shareItemsPath(token)}
          enhanced={enhanced}
          onEnhancedChange={setEnhancePreference}
        />
      )}
    </main>
  );
}
