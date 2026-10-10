"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

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
  // TRS-2: erasing now instead of in 30 days, for a deletion someone asked for.
  const [erasing, setErasing] = useState<{ id: string; typed: string } | null>(null);
  if (events.length === 0) return null;

  async function eraseNow(id: string) {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/events/${id}?erase=true`, { method: "DELETE" });
    setBusyId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not erase that event.");
      return;
    }
    setErasing(null);
    router.refresh();
  }

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
          <li key={event.id} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-paper">{event.name}</p>
                <p className="text-xs text-muted">Removed for good on {event.purgesOn}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => void restore(event.id)}>
                  {busyId === event.id && !erasing ? "Restoring…" : "Restore"}
                </Button>
                {erasing?.id !== event.id && (
                  <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setErasing({ id: event.id, typed: "" })}>
                    Erase now
                  </Button>
                )}
              </div>
            </div>
            {erasing?.id === event.id && (
              <form
                className="space-y-2 rounded-xl border border-canvas-line p-3"
                onSubmit={(submit) => {
                  submit.preventDefault();
                  void eraseNow(event.id);
                }}
              >
                <p className="text-sm text-paper">
                  Erase {event.name} now, with every photo and video guests shared, instead of on {event.purgesOn}? Use
                  this when someone has asked for their photos to be deleted. It cannot be undone.
                </p>
                <label className="block text-xs text-muted" htmlFor={`erase-${event.id}`}>
                  Type the event&apos;s name to confirm
                </label>
                <input
                  id={`erase-${event.id}`}
                  className={inputClass}
                  value={erasing.typed}
                  onChange={(change) => setErasing({ id: event.id, typed: change.target.value })}
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    disabled={busyId !== null || erasing.typed.trim().toLowerCase() !== event.name.trim().toLowerCase()}
                  >
                    {busyId === event.id ? "Erasing…" : "Erase for good"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setErasing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
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
