import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-xl border border-canvas-line bg-canvas px-3.5 py-2.5 text-sm text-paper placeholder:text-muted focus:border-volt/60 focus:outline-none focus:ring-1 focus:ring-volt/60";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  if (htmlFor) {
    return (
      <div>
        <label
          htmlFor={htmlFor}
          className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase"
        >
          {label}
        </label>
        {children}
        {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
