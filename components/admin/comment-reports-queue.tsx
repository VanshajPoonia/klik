"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface CommentReportRow {
  commentId: string;
  eventName: string;
  eventSlug: string;
  mediaId: string;
  body: string;
  authorName: string;
  hidden: "host" | "reports" | "klik" | null;
  safetyHold: boolean;
  reasons: string[];
  notes: string[];
  count: number;
  latest: string;
}

type Action = "keep" | "hide" | "delete";

/**
 * ADM-5 for comments (MED-9). Text, so unlike the photo queue it is shown
 * outright: reading it is the review. Child-safety reports first.
 */
export function CommentReportsQueue({ rows }: { rows: CommentReportRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-8 space-y-4 border-red-500/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Reported comments</h2>
        <Badge tone="danger">{rows.length}</Badge>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <CommentReportItem key={row.commentId} row={row} />
        ))}
      </ul>
    </Card>
  );
}

function CommentReportItem({ row }: { row: CommentReportRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: Action) {
    setBusy(action);
    setError(null);
    const response = await fetch(`/api/admin/comment-reports/${row.commentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      const body = response ? await response.json().catch(() => ({})) : {};
      setError(body.error ?? "That did not work");
      return;
    }
    router.refresh();
  }

  const ready = note.trim().length >= 3 && busy === null;
  return (
    <li className={`space-y-3 rounded-xl border p-4 ${row.safetyHold ? "border-red-500/50" : "border-canvas-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-paper">{row.eventName}</p>
          <p className="text-xs text-muted">
            {row.reasons.join(", ")} · {row.count} {row.count === 1 ? "report" : "reports"} · latest {row.latest}
          </p>
        </div>
        {row.safetyHold ? (
          <Badge tone="danger">child safety</Badge>
        ) : row.hidden ? (
          <Badge>hidden</Badge>
        ) : null}
      </div>
      <blockquote className="rounded-lg border border-canvas-line bg-canvas px-3 py-2 text-sm text-paper">
        <span className="text-xs text-muted">{row.authorName}</span>
        <p className="mt-1 whitespace-pre-wrap break-words">{row.body}</p>
      </blockquote>
      {row.notes.map((text, index) => (
        <p key={index} className="text-xs text-paper/80">
          Reporter: &ldquo;{text}&rdquo;
        </p>
      ))}
      <input
        aria-label="What you found"
        className={inputClass}
        placeholder={row.safetyHold ? "What you found, and any report you filed" : "What you found"}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" disabled={!ready} onClick={() => void act("hide")}>
          {busy === "hide" ? "Hiding…" : "Hide it"}
        </Button>
        <Button variant="danger" size="sm" disabled={!ready} onClick={() => void act("delete")}>
          {busy === "delete" ? "Deleting…" : "Delete it"}
        </Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => void act("keep")}>
          {busy === "keep" ? "Saving…" : "Keep it"}
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
