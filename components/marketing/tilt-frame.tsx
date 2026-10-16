"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A frame that leans toward the pointer, like a print picked up off the sheet.
 * Only for a fine pointer that can hover and a visitor who has not asked for
 * less motion; everyone else gets a frame that stays flat.
 */
export function TiltFrame({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  /** The steepest lean, in degrees, at the frame's edge. */
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useRef(false);

  useEffect(() => {
    const query = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    const update = () => {
      enabled.current = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div
      ref={ref}
      className={`tilt ${className}`}
      onPointerMove={(event) => {
        const element = ref.current;
        if (!element || !enabled.current) return;
        const box = element.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5;
        const y = (event.clientY - box.top) / box.height - 0.5;
        element.style.setProperty("--ry", `${(x * max * 2).toFixed(2)}deg`);
        element.style.setProperty("--rx", `${(-y * max * 2).toFixed(2)}deg`);
        element.dataset.tilting = "true";
      }}
      onPointerLeave={() => {
        const element = ref.current;
        if (!element) return;
        element.style.setProperty("--ry", "0deg");
        element.style.setProperty("--rx", "0deg");
        element.dataset.tilting = "false";
      }}
    >
      {children}
    </div>
  );
}
