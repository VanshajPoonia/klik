import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  /** For in-page links, such as the admin queue pointing at a client's card. */
  id?: string;
}) {
  return (
    // Merged rather than appended, so a caller's `p-0` actually replaces the
    // default padding instead of competing with it in the stylesheet.
    <div id={id} className={twMerge("rounded-2xl border border-canvas-line bg-canvas-raised p-6", className)}>
      {children}
    </div>
  );
}
