"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Marks its box `data-inview="true"` while any of it is on screen, so CSS can
 * run a vignette's loop (`.vg-run`) only while somebody can see it. Written to
 * the DOM directly rather than through state: nothing about the render changes,
 * and a re-render per scroll crossing would be wasted work.
 */
export function InView({
  children,
  className = "",
  threshold = 0.2,
}: {
  children: ReactNode;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        element.dataset.inview = String(entry.isIntersecting);
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={className} data-inview="false">
      {children}
    </div>
  );
}
