"use client";

import { useState, type FormEvent } from "react";
import { Plus, UserRound, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass, selectClass } from "@/components/ui/field";
import { ASSIGNABLE_ROLES, DEFAULT_CO_HOST_ROLE, ROLE_LABELS, type AssignableRole } from "@/lib/permissions";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api-client";

interface CoHost {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  role: AssignableRole;
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
  const [role, setRole] = useState<AssignableRole>(DEFAULT_CO_HOST_ROLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCoHost(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ coHost: CoHost }>(
      `/api/events/${eventId}/co-hosts`,
      { method: "POST", body: { identifier, role } },
      "Could not add this co-host",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Adding someone already on the team is how their role is changed, so
    // replace a matching row rather than appending a duplicate.
    setCoHosts((current) => [
      ...current.filter((existing) => existing.id !== result.data.coHost.id),
      result.data.coHost,
    ]);
    setIdentifier("");
    setRole(DEFAULT_CO_HOST_ROLE);
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
          Give someone access to this event, and decide how much.
        </p>
      </div>
      <form onSubmit={addCoHost} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Username or email"
            aria-label="Username or email"
            maxLength={254}
            required
          />
          <select
            className={`${selectClass} sm:w-44 sm:shrink-0`}
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
            aria-label="Role"
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option].label}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={busy || !identifier.trim()} className="shrink-0">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add co-host
          </Button>
        </div>
        <p className="text-xs text-muted">{ROLE_LABELS[role].description}</p>
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
                <span className="block truncate text-xs text-muted">
                  {ROLE_LABELS[coHost.role]?.label ?? coHost.role}
                  {(coHost.username || coHost.email) &&
                    ` \u00b7 ${coHost.username ? `@${coHost.username}` : coHost.email}`}
                </span>
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
