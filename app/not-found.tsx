import type { Metadata } from "next";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false },
};

/**
 * Also what a guest sees when a gallery link is wrong, expired, or points at an
 * event that was deleted, so the copy stays vague about which of those it is.
 * Confirming "this event exists but you cannot see it" would leak the existence
 * of private galleries to anyone guessing slugs.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Not found</p>
      <h1 className="max-w-lg font-display text-3xl text-paper sm:text-4xl">
        There is nothing at this link
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        The gallery may have ended, or the link may have been mistyped. Scanning the QR code again
        is usually the quickest fix.
      </p>
      <Link href="/" className={buttonClassName({ variant: "ghost" })}>
        Back to start
      </Link>
    </main>
  );
}
