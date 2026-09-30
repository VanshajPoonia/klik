import type { ButtonHTMLAttributes, ReactNode } from "react";

const tones = {
  neutral: "hover:bg-paper/5 hover:text-paper",
  danger: "hover:bg-red-500/10 hover:text-red-300",
};

/** Icon-only action with a 44px hit area. The label is required so the icon
 * always has an accessible name. */
export function IconButton({
  label,
  tone = "neutral",
  children,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  label: string;
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt disabled:opacity-50 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
