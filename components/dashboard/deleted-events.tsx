"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * SEC-4: events in their 30-day trash, with the way back. The restore route
 * existed with nothing calling it, which made deleting a whole wedding a
 * support ticket and an UPDATE by hand.
 *
 * A restored event comes back with uploads off, on purpose (see the route):
 * re-opening a gallery to guests should be a decision, not a side effect.
 */
export function DeletedEvents({
  events,
}: {
  events: Array<{ id: string; name: string; purgesOn: string }>;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (events.length === 0) return null;

  async function restore(id: string) {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/events/${id}/restore`, { method: "POST" });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not restore that event.");
      return;
    }
    router.push(`/dashboard/events/${id}`);
  }

  return (
    <section className="mt-10 space-y-3">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Recently deleted</h2>
      <ul className="divide-y divide-canvas-line rounded-2xl border border-canvas-line">
        {events.map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-paper">{event.name}</p>
              <p className="text-xs text-muted">Removed for good on {event.purgesOn}</p>
            </div>
            <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => void restore(event.id)}>
              {busyId === event.id ? "Restoring…" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
