import type { CSSProperties, ReactNode } from "react";

/**
 * One frame of film: sprocket holes above and below, the picture between, and
 * the frame number in edge print. Cells set side by side with no gap read as a
 * single strip, which is how every row of frames on the home page is built.
 */
export function FilmCell({
  children,
  n,
  label,
  className = "",
  style,
}: {
  children: ReactNode;
  /** The frame number printed on the rebate, like 12 or 12A. */
  n: string;
  /** Printed at the other end of the rebate, after the number. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`film flex flex-col ${className}`} style={style}>
      <div className="sprockets" aria-hidden="true" />
      <div className="px-[7px]">{children}</div>
      <div
        className="edge-print flex items-center justify-between gap-3 px-2.5 pt-2"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1.5">
          <EdgeArrow />
          {n}
        </span>
        {label && <span className="truncate">{label}</span>}
      </div>
      <div className="sprockets" aria-hidden="true" />
    </div>
  );
}

/** The small pointer film stock prints beside each frame number. */
export function EdgeArrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 6 8" className={`h-[7px] w-[5px] shrink-0 fill-current ${className}`} aria-hidden="true">
      <path d="M0 0l6 4-6 4z" />
    </svg>
  );
}
