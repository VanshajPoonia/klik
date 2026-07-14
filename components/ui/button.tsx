import type { ButtonHTMLAttributes } from "react";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const variants = {
  primary: "bg-volt text-canvas hover:brightness-95",
  ghost: "border border-canvas-line text-paper hover:border-paper/40",
  danger: "border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20",
};

const sizes = {
  sm: "px-3.5 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
  );
}
