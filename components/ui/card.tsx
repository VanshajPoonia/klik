import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-canvas-line bg-canvas-raised p-6 ${className}`}>
      {children}
    </div>
  );
}
