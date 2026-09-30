import Link from "next/link";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const variants = {
  primary: "bg-volt text-on-volt hover:brightness-95",
  ghost: "border border-canvas-line text-paper hover:border-paper/40",
};

const sizes = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <Link href={href} className={twMerge(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}
