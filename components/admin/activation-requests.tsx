import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ActivationRequestRow {
  eventId: string;
  eventName: string;
  userId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  eventDate: string | null;
  requestedAt: string;
  /** Within three days, or already past. The ones to do first. */
  urgent: boolean;
}

/**
 * ACT-4: drafts whose organizer asked for them to go live, soonest event first.
 * The grant itself happens on the client's card further down, which is where
 * the reason and the event picker are; this list is the to-do, not a second
 * place to grant from.
 */
export function ActivationRequests({ rows }: { rows: ActivationRequestRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-8 space-y-4 border-volt/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Waiting to go live</h2>
        <Badge tone="warning">{rows.length}</Badge>
      </div>
      <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
        {rows.map((row) => (
          <li key={row.eventId}>
            <a
              href={`#client-${row.userId}`}
              className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-paper">{row.eventName}</p>
                <p className="truncate text-xs text-muted">
                  {row.ownerName ?? "Unnamed"}
                  {row.ownerEmail ? ` · ${row.ownerEmail}` : ""} · asked {row.requestedAt}
                </p>
              </div>
              <Badge tone={row.urgent ? "danger" : "neutral"}>{row.eventDate ?? "no date"}</Badge>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
