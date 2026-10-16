"use client";

import { useEffect, useRef } from "react";

/**
 * A muted loop that plays only while it is on screen, and never for a visitor
 * who has asked for less motion: they see the poster, which is the loop's
 * first frame. Nothing is downloaded until the loop first comes into view.
 */
export function LoopVideo({
  src,
  poster,
  className = "",
}: {
  src: string;
  poster: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React renders `muted` on the server but does not set the property when it
    // hydrates, and an unmuted video is refused autoplay.
    video.muted = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduce.matches) {
          video.play().catch(() => {
            // Autoplay refused (Low Power Mode, a data saver). The poster stays.
          });
        } else {
          video.pause();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      tabIndex={-1}
      aria-hidden="true"
    />
  );
}
