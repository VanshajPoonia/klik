import type { ReactNode } from "react";

const tones = {
  neutral: "border-canvas-line text-muted",
  volt: "border-volt/30 bg-volt/10 text-volt",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-400",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
