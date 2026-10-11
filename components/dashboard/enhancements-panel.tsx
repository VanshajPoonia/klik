"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, WandSparkles } from "lucide-react";
import type { DashboardMedia } from "@/components/dashboard/media-grid";

/**
 * AI-5 on the dashboard: what is being sharpened and enlarged, and what came
 * back, each waiting for the host to choose. Asks again every few seconds
 * while a run is going, and refreshes the page when one lands so the new copy
 * is in the grid.
 */

export interface EnhancementView {
  id: string;
  mediaId: string;
  resultMediaId: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  choice: "instead" | "both" | "discarded" | null;
  error: string | null;
  createdAt: string;
}

interface State {
  available: boolean;
  allowance: { used: number; limit: number };
  enhancements: EnhancementView[];
}

const POLL_MS = 4_000;

export function useEnhancements(eventId: string, enabled: boolean) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const running = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/events/${eventId}/enhancements`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const next = (await response.json()) as State;
    const nowRunning = new Set(next.enhancements.filter((row) => row.status === "queued" || row.status === "running").map((row) => row.id));
    // Something finished since the last look: its copy is a new row.
    const landed = [...running.current].some((id) => !nowRunning.has(id));
    running.current = nowRunning;
    setState(next);
    if (landed) router.refresh();
  }, [eventId, router]);

  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(first);
  }, [enabled, refresh]);

  const busy = Boolean(state?.enhancements.some((row) => row.status === "queued" || row.status === "running"));
  useEffect(() => {
    if (!enabled || !busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, enabled, refresh]);

  const start = useCallback(
    async (mediaId: string): Promise<string | null> => {
      const response = await fetch(`/api/events/${eventId}/media/${mediaId}/enhance`, { method: "POST" }).catch(() => null);
      if (!response) return "No connection. Try again.";
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) return body.error ?? "That did not work";
      await refresh();
      return null;
    },
    [eventId, refresh],
  );

  const choose = useCallback(
    async (id: string, choice: "instead" | "both" | "discarded"): Promise<string | null> => {
      const response = await fetch(`/api/events/${eventId}/enhancements/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      }).catch(() => null);
      if (!response?.ok) return "That did not work";
      await refresh();
      router.refresh();
      return null;
    },
    [eventId, refresh, router],
  );

  return { state, refresh, start, choose, left: state ? Math.max(0, state.allowance.limit - state.allowance.used) : 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function EnhancementsPanel({
  enhancements,
  items,
  onOpen,
}: {
  enhancements: ReturnType<typeof useEnhancements>;
  items: DashboardMedia[];
  onOpen: (mediaId: string) => void;
}) {
  const { state, choose } = enhancements;
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!state) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const running = state.enhancements.filter((row) => row.status === "queued" || row.status === "running");
  const waiting = state.enhancements.filter((row) => row.status === "succeeded" && !row.choice && row.resultMediaId);
  // A failure is worth a line for a day, then it is history.
  const failed = state.enhancements.filter(
    (row) => row.status === "failed" && Date.now() - new Date(row.createdAt).getTime() < DAY_MS,
  );
  if (running.length === 0 && waiting.length === 0 && failed.length === 0) return null;

  const thumb = (id: string | null, label: string) => {
    const item = id ? byId.get(id) : undefined;
    const src = item?.thumbSrc ?? item?.src ?? null;
    return (
      <button
        type="button"
        onClick={() => id && onOpen(id)}
        disabled={!item}
        aria-label={label}
        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-canvas-line bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
      >
        {src && <Image src={src} alt="" fill unoptimized sizes="80px" className="object-cover" />}
      </button>
    );
  };

  async function act(id: string, choice: "instead" | "both" | "discarded") {
    setWorking(id);
    setError(null);
    const problem = await choose(id, choice);
    setWorking(null);
    if (problem) setError(problem);
  }

  const button =
    "min-h-11 rounded-full border border-canvas-line px-4 text-sm text-paper transition-colors hover:border-volt/50 hover:text-volt disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt";

  return (
    <section className="space-y-4 rounded-2xl border border-canvas-line bg-canvas-raised p-4" aria-labelledby="enhancements-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="enhancements-heading" className="flex items-center gap-2 text-sm font-medium text-paper">
          <WandSparkles className="h-4 w-4 text-volt" aria-hidden="true" />
          Enhancements
        </h2>
        <p className="text-xs text-muted">
          {state.allowance.used} of {state.allowance.limit} used for this event
        </p>
      </div>
      {running.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-line border-t-volt" aria-hidden="true" />
          Sharpening and enlarging {running.length === 1 ? "1 photo" : `${running.length} photos`}. This takes a minute or so.
        </p>
      )}
      {waiting.map((row) => (
        <div key={row.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            {thumb(row.mediaId, "Open the original")}
            <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />
            {thumb(row.resultMediaId, "Open the enhanced copy")}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-muted">Ready. Guests cannot see the copy until you choose.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={working === row.id} onClick={() => void act(row.id, "instead")} className={button}>
                Show it instead
              </button>
              <button type="button" disabled={working === row.id} onClick={() => void act(row.id, "both")} className={button}>
                Show both
              </button>
              <button type="button" disabled={working === row.id} onClick={() => void act(row.id, "discarded")} className={button}>
                Discard
              </button>
            </div>
          </div>
        </div>
      ))}
      {failed.length > 0 && (
        <p className="text-sm text-muted">
          {failed.length === 1 ? "One did not work this time." : `${failed.length} did not work this time.`} It has not used
          up an enhancement, and you can try again from the photo.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
