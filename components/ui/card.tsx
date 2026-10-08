import type { ReactNode } from "react";

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
    <div id={id} className={`rounded-2xl border border-canvas-line bg-canvas-raised p-6 ${className}`}>
      {children}
    </div>
  );
}
