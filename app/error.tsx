"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";

/**
 * Route-level error boundary. Without this, an unhandled exception showed the
 * framework's default error screen, which is untranslated, unbranded, and tells
 * a guest at a wedding nothing they can act on.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Until F-9 wires up Sentry this is the only trace that survives, and on
    // Vercel it lands in the function logs. The digest is what ties a report
    // from a guest ("it said DS4F2A") to the actual stack trace server-side.
    console.error("Unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Something broke</p>
      <h1 className="max-w-lg font-display text-3xl text-paper sm:text-4xl">
        That did not load properly
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        The problem is on our side, not yours. Nothing you uploaded has been lost. Try again, and
        if it keeps happening the code below helps us find it.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClassName({ variant: "ghost" })}>
          Back to start
        </Link>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted/70">Reference: {error.digest}</p>
      )}
    </main>
  );
}
