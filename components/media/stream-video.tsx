"use client";

import { useEffect, useRef, useState } from "react";

/**
 * OPS-1: plays a video from its Stream copy when it has one, and from the
 * original otherwise.
 *
 * Both go through the content route, which checks access first: `?hls=1`
 * answers with a tokened manifest from Stream. Safari and every iPhone, and
 * Chrome on Android, play HLS themselves; elsewhere hls.js does it, loaded
 * only now, so no gallery pays for it until someone presses play on a video
 * in a browser that needs it. Any failure falls back to the original, which
 * is exactly how every video played before Stream existed.
 */
export function StreamVideo({
  src,
  stream,
  poster,
  label,
  className,
  autoPlay = false,
}: {
  /** The content route for the original. */
  src: string;
  /** Whether a Stream copy is ready. */
  stream: boolean;
  poster?: string;
  label?: string;
  className?: string;
  autoPlay?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);
  const useStream = stream && !fallback;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!useStream) {
      video.src = src;
      return;
    }
    const manifest = `${src}${src.includes("?") ? "&" : "?"}hls=1`;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = manifest;
      return;
    }
    let cancelled = false;
    let destroy: (() => void) | null = null;
    import("hls.js/light")
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setFallback(true);
          return;
        }
        const hls = new Hls({ capLevelToPlayerSize: true });
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            hls.destroy();
            setFallback(true);
          }
        });
        hls.loadSource(manifest);
        hls.attachMedia(video);
      })
      .catch(() => setFallback(true));
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src, useStream]);

  return (
    <video
      ref={ref}
      poster={poster}
      aria-label={label}
      className={className}
      controls
      autoPlay={autoPlay}
      playsInline
      // Native HLS that fails (an expired token, a copy deleted meanwhile)
      // reports here; the original still plays.
      onError={() => {
        if (useStream) setFallback(true);
      }}
    />
  );
}
