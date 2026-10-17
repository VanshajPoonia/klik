"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, VideoOff } from "lucide-react";

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
 *
 * An original this browser cannot draw shows `unplayable` instead. iPhones
 * film HEVC, and a browser without it (a PC whose graphics cannot decode it,
 * Linux, older Android) loads the file, plays its sound over a black box and
 * reports no error at all: the only sign is a video with no picture size.
 * Most clips are H.264 by now, converted on the uploader's phone
 * (lib/video-compress.ts), and a Stream copy always is; this is for an
 * original that went up as filmed.
 */
export function StreamVideo({
  src,
  stream,
  poster,
  label,
  className,
  autoPlay = false,
  unplayable,
}: {
  /** The content route for the original. */
  src: string;
  /** Whether a Stream copy is ready. */
  stream: boolean;
  poster?: string;
  label?: string;
  className?: string;
  autoPlay?: boolean;
  /** Shown in place of the player when this browser cannot draw the original. */
  unplayable?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);
  const [cannotPlay, setCannotPlay] = useState(false);
  const useStream = stream && !fallback;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!useStream) {
      // QuickTime under its own name is refused by browsers that do not
      // claim it, though they play the same bytes named MP4 (lib/storage.ts).
      video.src = video.canPlayType("video/quicktime") ? src : `${src}${src.includes("?") ? "&" : "?"}as=mp4`;
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

  if (cannotPlay && unplayable) return <>{unplayable}</>;

  return (
    <video
      ref={ref}
      poster={poster}
      aria-label={label}
      className={className}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (!useStream && video.videoWidth === 0 && video.videoHeight === 0) setCannotPlay(true);
      }}
      // Native HLS that fails (an expired token, a copy deleted meanwhile)
      // reports here; the original still plays. An original that fails to
      // decode, or is a format this browser does not take, is unplayable.
      onError={(event) => {
        if (useStream) {
          setFallback(true);
          return;
        }
        const code = event.currentTarget.error?.code;
        if (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) setCannotPlay(true);
      }}
    />
  );
}

/** What a video this browser cannot draw shows instead of a black box. */
export function UnplayableVideo({
  title,
  body,
  downloadHref,
  downloadLabel,
}: {
  title: string;
  body: string;
  /** Null where downloads are off; the body should then not offer one. */
  downloadHref: string | null;
  downloadLabel: string;
}) {
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <VideoOff className="h-8 w-8 text-muted" aria-hidden="true" />
      <p className="max-w-xs font-display text-lg text-paper">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
      {downloadHref && (
        <a
          href={downloadHref}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {downloadLabel}
        </a>
      )}
    </div>
  );
}
