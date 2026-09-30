import type { InputHTMLAttributes, ReactNode } from "react";

export function Checkbox({
  children,
  hint,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-start gap-3 py-1.5 text-sm text-paper">
      <input
        {...props}
        type="checkbox"
        className={`mt-0.5 h-4 w-4 shrink-0 rounded border-canvas-line accent-volt ${className}`}
      />
      <span>
        {children}
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}
