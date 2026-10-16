import type { CSSProperties } from "react";

/**
 * A photographer's grease-pencil mark, in volt. Drawn by hand rather than
 * geometrically: the circle overshoots where it started, the underline
 * sags, so it reads as a mark somebody made on the sheet.
 */
const MARKS = {
  circle: {
    viewBox: "0 0 100 76",
    d: "M55 5C31 2 6 13 5 36c-1 22 25 36 52 34 27-2 41-18 38-37C92 13 72 3 41 9",
  },
  underline: {
    viewBox: "0 0 200 14",
    d: "M3 9C48 4 105 3 197 6M30 12c40-3 92-4 140-2",
  },
} as const;

export function GreaseMark({
  kind = "circle",
  className = "",
  delay,
  onView = false,
}: {
  kind?: keyof typeof MARKS;
  className?: string;
  /** When a load-time mark starts drawing. Ignored by `onView` marks. */
  delay?: string;
  /** Draw as the mark scrolls into view instead of on load. */
  onView?: boolean;
}) {
  const mark = MARKS[kind];
  return (
    <svg
      viewBox={mark.viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`grease pointer-events-none absolute overflow-visible ${onView ? "grease-on-view" : ""} ${className}`}
      style={delay ? ({ "--draw-delay": delay } as CSSProperties) : undefined}
    >
      <path d={mark.d} pathLength={1} />
    </svg>
  );
}
