"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Download, Pause, Play, X } from "lucide-react";

export interface LightboxItem {
  id: string;
  kind: "photo" | "video";
  blobUrl: string;
}

const SWIPE_THRESHOLD = 50;

/** Fullscreen viewer for the gallery. Deliberately dependency-free: the whole
 * surface is a photo, a counter, and two arrows. */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  downloadBaseUrl,
  canDownload = false,
  canSlideshow = false,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  downloadBaseUrl?: string;
  canDownload?: boolean;
  canSlideshow?: boolean;
}) {
  const touchStartX = useRef<number | null>(null);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  const item = items[index];

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.code === "Space" && canSlideshow && items.length > 1) {
        e.preventDefault();
        setSlideshowPlaying((playing) => !playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSlideshow, go, items.length, onClose]);

  useEffect(() => {
    if (!slideshowPlaying || items.length < 2 || !item) return;
    const delay = item.kind === "video" ? 12_000 : 6_000;
    const timer = window.setTimeout(() => {
      onIndexChange((index + 1) % items.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [index, item, items.length, onIndexChange, slideshowPlaying]);

  // Keep the page behind from scrolling under the viewer.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-black/95"
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(delta) > SWIPE_THRESHOLD) go(delta > 0 ? -1 : 1);
        touchStartX.current = null;
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-4">
        <span className="text-sm tabular-nums text-muted">
          {index + 1} / {items.length}
        </span>
        <div className="flex items-center gap-2">
          {canSlideshow && items.length > 1 && (
            <button
              type="button"
              onClick={() => setSlideshowPlaying((playing) => !playing)}
              aria-label={slideshowPlaying ? "Pause slideshow" : "Start slideshow"}
              aria-pressed={slideshowPlaying}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              {slideshowPlaying ? (
                <Pause className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Play className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          )}
          {canDownload && downloadBaseUrl && (
            <a
              href={`${downloadBaseUrl}/${item.id}/download`}
              aria-label={`Download ${item.kind}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {item.kind === "video" ? (
          <video
            key={item.id}
            src={item.blobUrl}
            className="h-full w-full object-contain"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <Image
            key={item.id}
            src={item.blobUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
        )}

        {index > 0 && (
          <button
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  );
}
