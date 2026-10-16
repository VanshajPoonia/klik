import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GrantControl } from "@/components/admin/grant-control";

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
 * ACT-4: drafts whose organizer asked for them to go live, soonest event first,
 * each with its own Go live form. It is the same grant as the one on the
 * client's page, through the same route, with the event already chosen, so
 * doing the queue no longer means scrolling to find the right card.
 */
export function ActivationRequests({ rows }: { rows: ActivationRequestRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mb-8 space-y-4 border-volt/30">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Waiting to go live</h2>
        <Badge tone="warning">{rows.length}</Badge>
      </div>
      <p className="text-xs text-muted">
        Find their payment in Stripe by the email shown, then press Go live. They are emailed when it is live.
      </p>
      <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
        {rows.map((row) => (
          <li key={row.eventId}>
            <details className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-paper">{row.eventName}</p>
                  <p className="truncate text-xs text-muted">
                    {row.ownerName ?? "Unnamed"}
                    {row.ownerEmail ? ` · ${row.ownerEmail}` : ""} · asked {row.requestedAt}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={row.urgent ? "danger" : "neutral"}>{row.eventDate ?? "no date"}</Badge>
                  <span className="rounded-full bg-volt px-3 py-1 text-xs font-medium text-on-volt group-open:hidden">
                    Go live
                  </span>
                  <span className="hidden text-xs text-muted group-open:inline">Close</span>
                </div>
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <GrantControl
                  userId={row.userId}
                  events={[]}
                  target={{ id: row.eventId, name: row.eventName, state: "draft" }}
                  settleMs={3000}
                />
                <Link href={`/admin/clients/${row.userId}`} className="inline-block text-xs text-muted hover:text-paper">
                  Open {row.ownerName ?? "the client"}&apos;s page
                </Link>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}
