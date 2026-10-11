"use client";

import { useEffect } from "react";
import { buildEvent, createThrottle, parseDsn, sendEvent } from "@/lib/sentry";

/**
 * F-9: what breaks in a guest's browser reaches Sentry too. Renders nothing,
 * and does nothing at all until `NEXT_PUBLIC_SENTRY_DSN` is set, which is
 * inlined at build time, so adding the DSN needs a redeploy.
 */
const DSN = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
const ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production";
const RELEASE = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

/** A page that throws in a loop sends a handful, not thousands. */
const PER_PAGE_LIMIT = 5;
let sent = 0;
const allow = createThrottle(60_000, 50);

/** Errors from browser extensions and third-party scripts are not Klik's. */
function isOurs(filename: string | undefined): boolean {
  if (!filename) return true;
  try {
    return new URL(filename, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function reportClientError(error: unknown, name = "client.unhandled", context: Record<string, unknown> = {}) {
  if (!DSN || process.env.NODE_ENV !== "production") return;
  if (sent >= PER_PAGE_LIMIT) return;
  const message = error instanceof Error ? error.message : String(error);
  // A chunk that failed to load after a deploy is a reload, not a bug.
  if (/Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(message)) return;
  if (!allow(`${name}:${message}`)) return;
  sent += 1;
  void sendEvent(
    DSN,
    buildEvent(error, {
      platform: "javascript",
      environment: ENVIRONMENT,
      release: RELEASE,
      name,
      url: window.location.href,
      context,
    }),
  );
}

export function ErrorReporting() {
  useEffect(() => {
    if (!DSN) return;
    const onError = (event: ErrorEvent) => {
      if (!isOurs(event.filename)) return;
      reportClientError(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, "client.unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
