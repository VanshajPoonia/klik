"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface PausedGalleryRow {
  eventId: string;
  eventName: string;
  eventSlug: string;
  ownerEmail: string | null;
  since: string;
  reason: string;
}

/** ADM-5: galleries Klik has paused, with what their organizers were told. */
export function PausedGalleries({ rows }: { rows: PausedGalleryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-8 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Paused galleries</h2>
        <Badge tone="warning">{rows.length}</Badge>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <PausedItem key={row.eventId} row={row} />
        ))}
      </ul>
    </Card>
  );
}

function PausedItem({ row }: { row: PausedGalleryRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/events/${row.eventId}/suspension`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lift", note }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "That did not work");
      return;
    }
    router.refresh();
  }

  return (
    <li className="space-y-3 rounded-xl border border-canvas-line p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-paper">{row.eventName}</p>
        <p className="text-xs text-muted">
          /e/{row.eventSlug} · {row.ownerEmail ?? "no owner email"} · paused {row.since}
        </p>
        <p className="mt-1 text-xs text-paper/80">Told the organizer: &ldquo;{row.reason}&rdquo;</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Why it is reopening"
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="Why it is reopening, for the record"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={300}
        />
        <Button variant="ghost" size="sm" disabled={busy || note.trim().length < 3} onClick={() => void reopen()}>
          {busy ? "Reopening…" : "Reopen and tell the organizer"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
