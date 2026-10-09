"use client";

import { useEffect, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import type { PrintDoc } from "@/lib/print/doc";

interface Version {
  id: string;
  revision: number;
  createdAt: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
}

/**
 * QR-4a: earlier states of the design, kept every few minutes of work, the
 * last ten. Putting one back keeps the current state as a version too, so
 * nothing here is a one-way door.
 */
export function VersionsDialog({
  eventId,
  designId,
  onRestored,
  onClose,
}: {
  eventId: string;
  designId: string;
  onRestored: (design: { revision: number; doc: PrintDoc }) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void apiRequest<{ versions: Version[] }>(`/api/events/${eventId}/designs/${designId}/versions`).then((result) => {
      if (result.ok) setVersions(result.data.versions);
      else setError(result.error);
    });
  }, [designId, eventId]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  async function restore(version: Version) {
    setBusy(version.id);
    setError(null);
    const result = await apiRequest<{ design: { revision: number; doc: PrintDoc } }>(
      `/api/events/${eventId}/designs/${designId}/versions`,
      { method: "POST", body: { versionId: version.id } },
      "That version could not be put back.",
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRestored(result.data.design);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Earlier versions"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-canvas-line bg-canvas-raised p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-paper">Earlier versions</h2>
            <p className="mt-1 text-xs text-muted">
              Kept every few minutes while you work, the last ten. Putting one back keeps what you have now as a version too.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {error && (
          <p className="mb-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        {versions === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <History className="h-4 w-4" aria-hidden="true" />
            None yet. One is kept once you have worked on this for a few minutes.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 rounded-xl border border-canvas-line px-3 py-2">
                <span className="text-sm text-paper">{when(version.createdAt)}</span>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void restore(version)}>
                  {busy === version.id ? "Putting back…" : "Put this back"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
