"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { downloadFilename, enhancePhoto, saveBlob } from "@/lib/enhance-view";

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
  slug,
  enhanced = false,
  onEnhancedChange,
  onShare,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  downloadBaseUrl?: string;
  canDownload?: boolean;
  canSlideshow?: boolean;
  slug?: string;
  enhanced?: boolean;
  onEnhancedChange?: (next: boolean) => void;
  /** Organizer-only: opens the share sheet for the photo on screen. Absent on
   *  the guest side, where nobody may create links. */
  onShare?: (id: string) => void;
}) {
  const touchStartX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  // Keyed by media id rather than reset on change, so nothing has to call
  // setState from an effect body just to clear a stale result.
  const [enhancedFor, setEnhancedFor] = useState<{ id: string; url: string } | null>(null);
  const enhancedBlob = useRef<Blob | null>(null);
  const item = items[index];
  const enhancedUrl = item && enhancedFor?.id === item.id ? enhancedFor.url : null;

  /**
   * Auto-levels the photo on this device. The original is shown immediately and
   * the enhanced version swapped in when it is ready, so the viewer never waits
   * on a blank frame. Aborting on change matters more than it looks: swiping
   * quickly through a gallery starts one of these per photo, and without the
   * abort they all finish and fight over the same state.
   */
  useEffect(() => {
    if (!enhanced || !item || item.kind !== "photo") return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    enhancePhoto(item.blobUrl, controller.signal).then((blob) => {
      if (controller.signal.aborted || !blob) return;
      enhancedBlob.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setEnhancedFor({ id: item.id, url: objectUrl });
    });

    return () => {
      controller.abort();
      enhancedBlob.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enhanced, item]);

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

  // Move focus into the viewer, and hand it back to the tile that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

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
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
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
          {onEnhancedChange && (
            <button
              type="button"
              onClick={() => onEnhancedChange(!enhanced)}
              aria-label={enhanced ? "Show the original photo" : "Enhance photos"}
              aria-pressed={enhanced}
              title={enhanced ? "Enhanced. Tap to see the original" : "Enhance"}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 ${
                enhanced ? "bg-volt text-on-volt" : "bg-white/10 text-paper"
              }`}
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(item.id)}
              aria-label={`Share this ${item.kind}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canDownload && downloadBaseUrl && (
            // When an enhanced version exists, save those bytes rather than
            // following the link, so what you download is what you were
            // looking at. Falls back to the server route for videos, for
            // originals, and whenever enhancement did not produce anything.
            <a
              href={`${downloadBaseUrl}/${item.id}/download`}
              aria-label={`Download ${item.kind}`}
              onClick={(event) => {
                const blob = enhancedBlob.current;
                if (!blob || !slug) return;
                event.preventDefault();
                saveBlob(blob, downloadFilename(slug, item.id));
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <button
            ref={closeRef}
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
            aria-label={`Video ${index + 1} of ${items.length}`}
            className="h-full w-full object-contain"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <Image
            key={item.id}
            src={enhancedUrl ?? item.blobUrl}
            alt={`Photo ${index + 1} of ${items.length}`}
            fill
            unoptimized
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
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
