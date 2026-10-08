"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/plans";

interface ExportSummary {
  id: string;
  status: "building" | "ready" | "failed" | "expired";
  label: string;
  partCount: number;
  partsDone: number;
  totalBytes: number;
  createdAt: string;
  expiresAt: string | null;
  parts: Array<{ number: number; ready: boolean; bytes: number; files: number }>;
}

/**
 * MED-7: downloads too big to stream through one request. "Prepare download"
 * queues a ZIP export built in the background, this panel watches it, and the
 * finished parts download straight from storage at whatever speed the
 * connection manages. The organizer also gets an email, so they can leave.
 *
 * Polls only while something is building, and stops when it is all done.
 */
export function ExportsPanel({
  eventId,
  approvedCount,
  approvedBytes,
  refreshKey = 0,
}: {
  eventId: string;
  approvedCount: number;
  approvedBytes: number;
  /** Bumped by the parent when it created an export itself, from a selection. */
  refreshKey?: number;
}) {
  const [exports, setExports] = useState<ExportSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/events/${eventId}/exports`, { cache: "no-store" });
    if (!response.ok) return;
    const body: { exports: ExportSummary[] } = await response.json();
    setExports(body.exports);
  }, [eventId]);

  // Reading server state into the component is the case effects are for. The
  // rule cannot tell that `load` only sets state after an awaited fetch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const building = exports?.some((row) => row.status === "building") ?? false;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5_000);
    return () => clearInterval(timer);
  }, [building, load]);

  async function prepare() {
    setCreating(true);
    setError(null);
    const response = await fetch(`/api/events/${eventId}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) {
      setError(body.error ?? "Could not start the download");
      return;
    }
    await load();
  }

  const visible = (exports ?? []).filter((row) => row.status !== "expired").slice(0, 3);

  return (
    <section className="space-y-4 border-b border-canvas-line pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-md text-sm text-muted">
          {approvedCount} items, {formatFileSize(approvedBytes)}. Too big to download in one go, so
          it is packed into ZIP files in the background. We will email you when it is ready.
        </p>
        <Button onClick={() => void prepare()} disabled={creating || building} size="sm">
          {creating ? "Starting…" : building ? "Preparing…" : "Prepare download"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {visible.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line" aria-live="polite">
          {visible.map((row) => (
            <li key={row.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-paper">
                  {row.label}
                  <span className="font-normal text-muted">
                    {" "}
                    ·{" "}
                    {row.status === "building"
                      ? `packing ${row.partsDone} of ${row.partCount}`
                      : row.status === "ready"
                        ? `${formatFileSize(row.totalBytes)}, ready${
                            row.expiresAt
                              ? ` until ${new Date(row.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                              : ""
                          }`
                        : "could not be prepared. Try again"}
                  </span>
                </p>
                {row.status === "building" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted motion-reduce:animate-none" aria-hidden="true" />
                )}
              </div>
              {row.status === "ready" && (
                <div className="flex flex-wrap gap-2">
                  {row.parts.map((part) => (
                    <a
                      key={part.number}
                      href={`/api/events/${eventId}/exports/${row.id}/parts/${part.number}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      {row.partCount === 1 ? "Download ZIP" : `Part ${part.number}`}
                      <span className="text-xs text-muted">
                        {part.files} items, {formatFileSize(part.bytes)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
