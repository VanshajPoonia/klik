"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Pause, Play } from "lucide-react";

interface LiveItem {
  id: string;
  kind: "photo" | "video";
  status: string;
  visibility: string;
  createdAt: string | Date;
  src?: string | null;
  thumbSrc?: string | null;
  posterSrc?: string | null;
  blobUrl: string;
  posterUrl?: string | null;
}

/** How long a photo stays on screen. */
const DWELL_MS = 7_000;
/** A new upload waits this long before it can appear, so a host has a minute
 *  to remove something before it is ten feet tall in front of everyone. */
const ARRIVAL_DELAY_MS = 60_000;
const POLL_MS = 10_000;
/** Signed URLs last 15 to 30 minutes; a screen runs all night. */
const REFRESH_MS = 10 * 60 * 1000;

/** Only what a guest would see. The page already filtered, polls re-check. */
function showable(item: LiveItem): boolean {
  return item.status === "approved" && item.visibility === "gallery";
}

function imageFor(item: LiveItem): string {
  return item.kind === "video"
    ? (item.posterSrc ?? item.posterUrl ?? `${item.blobUrl}?thumb=1`)
    : (item.src ?? item.blobUrl);
}

export function LiveDisplay({
  slug,
  eventName,
  accent,
  qrDataUrl,
  shortUrl,
  initialMedia,
  syncedAt,
}: {
  slug: string;
  eventName: string;
  accent: string;
  qrDataUrl: string;
  shortUrl: string;
  initialMedia: LiveItem[];
  syncedAt: string;
}) {
  const [items, setItems] = useState<LiveItem[]>(() => initialMedia.filter(showable));
  const [currentId, setCurrentId] = useState<string | null>(() => initialMedia.find(showable)?.id ?? null);
  const [paused, setPaused] = useState(false);
  const [chrome, setChrome] = useState(true);
  const seenIds = useRef(new Set(initialMedia.map((item) => item.id)));
  const since = useRef(syncedAt);
  // Read by timers and pollers, which must see the latest values without
  // being torn down and restarted on every change. Newest arrivals wait in the
  // queue and jump ahead of gallery order once their delay has passed.
  const itemsRef = useRef(items);
  const currentRef = useRef(currentId);
  const queueRef = useRef<string[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    currentRef.current = currentId;
  }, [currentId]);

  const advance = useCallback((step = 1) => {
    const now = Date.now();
    const eligible = itemsRef.current.filter(
      (item) => showable(item) && now - new Date(item.createdAt).getTime() >= ARRIVAL_DELAY_MS,
    );
    if (step > 0) {
      const queued = queueRef.current.find((id) => eligible.some((item) => item.id === id));
      if (queued) {
        queueRef.current = queueRef.current.filter((id) => id !== queued);
        setCurrentId(queued);
        return;
      }
    }
    if (eligible.length === 0) {
      setCurrentId(null);
      return;
    }
    const index = eligible.findIndex((item) => item.id === currentRef.current);
    setCurrentId(eligible[(index + step + eligible.length) % eligible.length].id);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => advance(1), DWELL_MS);
    return () => clearInterval(timer);
  }, [advance, paused]);

  // New uploads, removals and moderation, through the same changes endpoint the
  // gallery uses. A photo the host hides leaves the screen on the next poll.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/e/${slug}/media/changes?since=${encodeURIComponent(since.current)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data: { at: string; resync?: boolean; upserts?: LiveItem[]; removed?: string[] } = await res.json();
        since.current = data.at;
        if (data.resync) {
          await refresh();
          return;
        }
        const upserts = (data.upserts ?? []).filter(showable);
        const gone = new Set([...(data.removed ?? []), ...(data.upserts ?? []).filter((item) => !showable(item)).map((item) => item.id)]);
        if (upserts.length === 0 && gone.size === 0) return;
        setItems((current) => {
          const byId = new Map(current.filter((item) => !gone.has(item.id)).map((item) => [item.id, item]));
          for (const item of upserts) byId.set(item.id, item);
          return [...byId.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        });
        const fresh = upserts.filter((item) => !seenIds.current.has(item.id)).map((item) => item.id);
        for (const id of fresh) seenIds.current.add(id);
        queueRef.current = [...queueRef.current.filter((id) => !gone.has(id)), ...fresh];
        if (currentRef.current && gone.has(currentRef.current)) advance(1);
      } catch {
        // A dropped poll is fine: the screen keeps showing what it has.
      }
    };
    const refresh = async () => {
      const res = await fetch(`/api/e/${slug}/media?limit=100`, { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data: { media: LiveItem[] } = await res.json();
      setItems(data.media.filter(showable));
    };
    const pollTimer = setInterval(poll, POLL_MS);
    const refreshTimer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(refreshTimer);
    };
  }, [advance, slug]);

  // Keep the screen from sleeping, and take it back after a tab switch.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
        lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVisible = () => document.visibilityState === "visible" && void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Controls appear on movement and fade, so the screen is only photos.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setChrome(true);
      clearTimeout(timer);
      timer = setTimeout(() => setChrome(false), 3_000);
    };
    show();
    window.addEventListener("mousemove", show);
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key === "ArrowRight") advance(1);
      else if (event.key === "ArrowLeft") advance(-1);
      show();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("keydown", onKey);
    };
  }, [advance]);

  const current = items.find((item) => item.id === currentId) ?? null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-black" style={{ cursor: chrome ? "default" : "none" }}>
      {current ? (
        // Keyed by id so each change is a fresh element that fades in.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current.id}
          src={imageFor(current)}
          alt=""
          className="klik-live-fade absolute inset-0 h-full w-full object-contain"
          onError={(event) => {
            const fallback = current.kind === "video" ? `${current.blobUrl}?thumb=1` : current.blobUrl;
            if (event.currentTarget.src !== new URL(fallback, window.location.href).href) event.currentTarget.src = fallback;
          }}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-4xl text-paper">{eventName}</p>
          <p className="text-lg text-muted">Photos appear here as guests share them.</p>
        </div>
      )}

      <aside className="absolute bottom-6 right-6 flex items-center gap-4 rounded-2xl bg-black/70 p-3 backdrop-blur">
        <div className="text-right">
          <p className="text-sm font-semibold" style={{ color: accent }}>
            Scan to add yours
          </p>
          <p className="text-xs text-paper/80">{shortUrl}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt={`QR code for ${shortUrl}`} className="h-28 w-28 rounded-lg" />
      </aside>

      <div
        className={`absolute left-6 top-6 flex gap-2 transition-opacity duration-500 ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? "Resume" : "Pause"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper"
        >
          {paused ? <Play className="h-5 w-5" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
          aria-label="Full screen"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper"
        >
          <Maximize className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
