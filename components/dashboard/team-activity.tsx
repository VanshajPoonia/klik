import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ActivityEntry } from "@/lib/activity";

/**
 * ORG-4: who on the team did what. Newest first, and short: this answers "who
 * deleted that?" and "when did she join?", not a forensic question. Klik's own
 * record of everything is ADM-4, on /admin/audit.
 */
export function TeamActivity({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-paper">Team activity</h2>
        <p className="mt-1 text-xs text-muted">Changes to the team, the address, and what was removed.</p>
      </div>
      {entries.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <History className="h-4 w-4" aria-hidden="true" />
          Nothing yet.
        </p>
      ) : (
        <ol className="divide-y divide-canvas-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2">
              <p className="min-w-0 text-sm text-paper">
                <span className="font-medium">{entry.who}</span>{" "}
                <span className="text-muted">{entry.what}</span>
              </p>
              <time className="shrink-0 text-xs tabular-nums text-muted" dateTime={entry.at}>
                {new Date(entry.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
