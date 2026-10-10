"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface ReportRow {
  mediaId: string;
  eventId: string;
  /** ADM-5: the whole gallery is paused. */
  eventSuspended: boolean;
  /** ADM-5: when the organizer was asked to look, already formatted. */
  organizerNotified: string | null;
  eventName: string;
  eventSlug: string;
  held: boolean;
  reasons: string[];
  notes: string[];
  count: number;
  latest: string;
}

type Action = "dismiss" | "remove" | "release_hold" | "reported_to_ncmec" | "notify_organizer";

/** What the organizer is told by default when a gallery is paused. Theirs to read, so nothing internal. */
const DEFAULT_PAUSE_REASON = "We received a report about content in this gallery and have paused it while we review it.";

/**
 * ADM-5: every photo with an open report, held ones first.
 *
 * The image is behind a button rather than shown, for two reasons. A queue of
 * reported photos is a page nobody should have open on a screen by accident,
 * and for a child-safety report NCMEC's guidance is to view only as much as the
 * decision needs and never to copy or forward it.
 */
export function ReportsQueue({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-8 space-y-4 border-red-500/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Reports</h2>
        <Badge tone="danger">{rows.length}</Badge>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <ReportItem key={row.mediaId} row={row} />
        ))}
      </ul>
    </Card>
  );
}

function ReportItem({ row }: { row: ReportRow }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Action | "suspend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseReason, setPauseReason] = useState(DEFAULT_PAUSE_REASON);

  async function pause() {
    setBusy("suspend");
    setError(null);
    const response = await fetch(`/api/admin/events/${row.eventId}/suspension`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "suspend", reason: pauseReason, note }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setError(body.error ?? "That did not work");
      return;
    }
    setPausing(false);
    router.refresh();
  }

  async function act(action: Action) {
    setBusy(action);
    setError(null);
    const response = await fetch(`/api/admin/reports/${row.mediaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setError(body.error ?? "That did not work");
      return;
    }
    router.refresh();
  }

  const ready = note.trim().length >= 3 && busy === null;
  return (
    <li className={`space-y-3 rounded-xl border p-4 ${row.held ? "border-red-500/50" : "border-canvas-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-paper">{row.eventName}</p>
          <p className="text-xs text-muted">
            {row.reasons.join(", ")} · {row.count} {row.count === 1 ? "report" : "reports"} · latest {row.latest}
          </p>
          {row.notes.map((text, index) => (
            <p key={index} className="mt-1 text-xs text-paper/80">
              &ldquo;{text}&rdquo;
            </p>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row.held && <Badge tone="danger">legal hold</Badge>}
          {row.eventSuspended && <Badge tone="warning">gallery paused</Badge>}
          {row.organizerNotified && <Badge tone="neutral">organizer asked {row.organizerNotified}</Badge>}
        </div>
      </div>

      {show ? (
        <div className="relative h-40 w-40 overflow-hidden rounded-lg border border-canvas-line">
          <Image
            src={`/api/e/${row.eventSlug}/media/${row.mediaId}/content?thumb=1`}
            alt="Reported media"
            fill
            unoptimized
            className="object-cover"
          />
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setShow(true)}>
          Show the image
        </Button>
      )}

      <input
        aria-label="What you found"
        className={inputClass}
        placeholder={row.held ? "What you found, and the CyberTipline report number if you filed one" : "What you found"}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
      />
      <div className="flex flex-wrap gap-2">
        {row.held ? (
          <>
            <Button variant="danger" size="sm" disabled={!ready} onClick={() => void act("reported_to_ncmec")}>
              {busy === "reported_to_ncmec" ? "Saving…" : "Reported to NCMEC, keep held"}
            </Button>
            <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void act("release_hold")}>
              {busy === "release_hold" ? "Releasing…" : "False report, release"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger" size="sm" disabled={!ready} onClick={() => void act("remove")}>
              {busy === "remove" ? "Removing…" : "Remove it"}
            </Button>
            <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void act("dismiss")}>
              {busy === "dismiss" ? "Saving…" : "Keep it"}
            </Button>
            {/* Never for a held photo: the organizer may be who it is about. */}
            {!row.organizerNotified && (
              <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void act("notify_organizer")}>
                {busy === "notify_organizer" ? "Sending…" : "Ask the organizer to review"}
              </Button>
            )}
          </>
        )}
        {!row.eventSuspended && (
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setPausing((open) => !open)} aria-expanded={pausing}>
            Pause the whole gallery
          </Button>
        )}
      </div>
      {pausing && (
        <div className="space-y-2 rounded-lg border border-canvas-line p-3">
          <label className="block text-xs text-muted" htmlFor={`pause-${row.mediaId}`}>
            What the organizer is told, by email and on their dashboard. Keep anything you found, and any report
            number, in the note above, which only Klik sees.
          </label>
          <textarea
            id={`pause-${row.mediaId}`}
            className={`${inputClass} min-h-20`}
            value={pauseReason}
            onChange={(event) => setPauseReason(event.target.value)}
            maxLength={500}
          />
          <Button
            variant="danger"
            size="sm"
            disabled={!ready || pauseReason.trim().length < 10}
            onClick={() => void pause()}
          >
            {busy === "suspend" ? "Pausing…" : "Pause it and tell the organizer"}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
