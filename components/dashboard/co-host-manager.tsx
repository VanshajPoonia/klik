"use client";

import { useState, type FormEvent } from "react";
import { Plus, UserRound, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api-client";

interface CoHost {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
}

export function CoHostManager({
  eventId,
  initialCoHosts,
}: {
  eventId: string;
  initialCoHosts: CoHost[];
}) {
  const [coHosts, setCoHosts] = useState(initialCoHosts);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCoHost(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ coHost: CoHost }>(
      `/api/events/${eventId}/co-hosts`,
      { method: "POST", body: { identifier } },
      "Could not add this co-host",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCoHosts((current) => [...current, result.data.coHost]);
    setIdentifier("");
  }

  async function removeCoHost(userId: string) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(
      `/api/events/${eventId}/co-hosts/${userId}`,
      { method: "DELETE" },
      "Could not remove this co-host",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCoHosts((current) => current.filter((coHost) => coHost.id !== userId));
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-paper">Co-hosts</h2>
        <p className="mt-1 text-xs text-muted">
          Co-hosts can moderate, organize, and download this event.
        </p>
      </div>
      <form onSubmit={addCoHost} className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="Username or email"
          maxLength={254}
          required
        />
        <Button type="submit" disabled={busy || !identifier.trim()} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add co-host
        </Button>
      </form>
      {coHosts.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {coHosts.map((coHost) => (
            <li key={coHost.id} className="flex min-h-14 items-center gap-3 pl-3 pr-1">
              <UserRound className="h-4 w-4 shrink-0 text-volt" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-paper">
                  {coHost.name || coHost.username || coHost.email}
                </span>
                {(coHost.username || coHost.email) && (
                  <span className="block truncate text-xs text-muted">
                    {coHost.username ? `@${coHost.username}` : coHost.email}
                  </span>
                )}
              </span>
              <IconButton
                tone="danger"
                label={`Remove ${coHost.name || coHost.username || "co-host"}`}
                onClick={() => void removeCoHost(coHost.id)}
                disabled={busy}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
