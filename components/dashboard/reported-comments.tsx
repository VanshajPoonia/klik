"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface ReportedCommentRow {
  commentId: string;
  mediaId: string;
  body: string;
  authorName: string;
  hidden: "host" | "reports" | "klik" | null;
  reasons: string[];
  count: number;
  safetyHold: boolean;
}

/**
 * MED-9: comments guests reported, for the team to look at. Above the grid
 * because a reported comment is under a photo the host may never open again.
 * One hidden after a child-safety report is Klik's, and says so.
 */
export function ReportedComments({
  slug,
  rows,
  onOpenMedia,
}: {
  slug: string;
  rows: ReportedCommentRow[];
  onOpenMedia: (mediaId: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="space-y-4 border-red-500/30">
      <h2 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
        Reported comments ({rows.length})
      </h2>
      <ul className="space-y-3">
        {rows.map((row) => (
          <ReportedCommentItem key={row.commentId} slug={slug} row={row} onOpenMedia={onOpenMedia} />
        ))}
      </ul>
    </Card>
  );
}

function ReportedCommentItem({
  slug,
  row,
  onOpenMedia,
}: {
  slug: string;
  row: ReportedCommentRow;
  onOpenMedia: (mediaId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"hide" | "show" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "hide" | "show") {
    setBusy(action);
    setError(null);
    const response = await fetch(
      `/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(row.mediaId)}/comments/${encodeURIComponent(row.commentId)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
    ).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      const body = response ? await response.json().catch(() => ({})) : {};
      setError(body.error ?? "That did not work. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="space-y-2 rounded-xl border border-canvas-line p-4">
      <p className="text-sm text-paper">
        <span className="font-medium">{row.authorName}</span>
        <span className="text-muted"> wrote</span>
      </p>
      <p className="whitespace-pre-wrap break-words text-sm text-paper/90">&ldquo;{row.body}&rdquo;</p>
      <p className="text-xs text-muted">
        {row.reasons.join(", ")} · {row.count} {row.count === 1 ? "report" : "reports"}
        {row.hidden === "reports" && " · hidden until you look"}
        {row.hidden === "host" && " · hidden by your team"}
      </p>
      {row.safetyHold ? (
        <p className="text-xs text-muted">Hidden from everyone while Klik reviews it. Nothing for you to do.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {row.hidden !== "host" && (
            <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => void act("hide")}>
              {busy === "hide" ? "Hiding…" : row.hidden ? "Keep it hidden" : "Hide it"}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void act("show")}>
            {busy === "show" ? "Saving…" : row.hidden ? "Show it again" : "Keep it up"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenMedia(row.mediaId)}>
            See the photo
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
