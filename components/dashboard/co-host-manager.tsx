"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightLeft, Mail, Plus, RotateCw, UserRound, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass, selectClass } from "@/components/ui/field";
import { ASSIGNABLE_ROLES, DEFAULT_CO_HOST_ROLE, ROLE_LABELS, type AssignableRole } from "@/lib/permissions";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api-client";

export interface CoHost {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  role: AssignableRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: AssignableRole;
  expiresAt: string;
}

function displayName(coHost: CoHost) {
  return coHost.name || coHost.username || coHost.email || "Co-host";
}

/**
 * ORG-2, ORG-3, ORG-4: the event's team.
 *
 * Managers can add and invite; only the owner removes people or hands the event
 * over, which matches what the routes allow. A handover is an offer: nothing
 * moves until the recipient accepts it from their own dashboard.
 */
export function CoHostManager({
  eventId,
  isOwner,
  initialCoHosts,
  initialInvites = [],
  initialTransferTo = null,
}: {
  eventId: string;
  isOwner: boolean;
  initialCoHosts: CoHost[];
  initialInvites?: PendingInvite[];
  initialTransferTo?: string | null;
}) {
  const [coHosts, setCoHosts] = useState(initialCoHosts);
  const [invites, setInvites] = useState(initialInvites);
  const [transferTo, setTransferTo] = useState(initialTransferTo);
  const [confirmingHandover, setConfirmingHandover] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<AssignableRole>(DEFAULT_CO_HOST_ROLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T>(request: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await request;
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result.data;
  }

  async function addCoHost(event: FormEvent, override?: { identifier: string; role: AssignableRole }) {
    event.preventDefault();
    const body = override ?? { identifier, role };
    const data = await run(
      apiRequest<{ coHost?: CoHost; invite?: PendingInvite }>(
        `/api/events/${eventId}/co-hosts`,
        { method: "POST", body },
        "Could not add this co-host",
      ),
    );
    if (!data) return;
    if (data.coHost) {
      const added = data.coHost;
      // Adding someone already on the team is how their role is changed, so
      // replace a matching row rather than appending a duplicate.
      setCoHosts((current) => [...current.filter((existing) => existing.id !== added.id), added]);
      if (added.role !== "manager" && transferTo === added.id) setTransferTo(null);
    }
    if (data.invite) {
      const sent = data.invite;
      setInvites((current) => [sent, ...current.filter((existing) => existing.email !== sent.email)]);
      setNotice(`Invitation sent to ${sent.email}.`);
    }
    if (!override) {
      setIdentifier("");
      setRole(DEFAULT_CO_HOST_ROLE);
    }
  }

  async function removeCoHost(userId: string) {
    const data = await run(
      apiRequest(`/api/events/${eventId}/co-hosts/${userId}`, { method: "DELETE" }, "Could not remove this co-host"),
    );
    if (!data) return;
    setCoHosts((current) => current.filter((coHost) => coHost.id !== userId));
    if (transferTo === userId) setTransferTo(null);
  }

  async function withdrawInvite(inviteId: string) {
    const data = await run(
      apiRequest(`/api/events/${eventId}/invites/${inviteId}`, { method: "DELETE" }, "Could not withdraw this invitation"),
    );
    if (!data) return;
    setInvites((current) => current.filter((invite) => invite.id !== inviteId));
  }

  async function offerHandover(userId: string) {
    const data = await run(
      apiRequest(`/api/events/${eventId}/transfer`, { method: "POST", body: { toUserId: userId } }, "Could not offer the event"),
    );
    setConfirmingHandover(null);
    if (!data) return;
    setTransferTo(userId);
  }

  async function withdrawHandover() {
    const data = await run(
      apiRequest(`/api/events/${eventId}/transfer`, { method: "DELETE" }, "Could not withdraw the offer"),
    );
    if (!data) return;
    setTransferTo(null);
  }

  const looksLikeEmail = identifier.includes("@");

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-paper">Team</h2>
        <p className="mt-1 text-xs text-muted">
          Give someone access to this event, and decide how much. Anyone without a Klik account gets
          an invitation by email.
        </p>
      </div>
      <form onSubmit={(event) => void addCoHost(event)} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Username or email"
            aria-label="Username or email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
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
            {looksLikeEmail ? "Add or invite" : "Add"}
          </Button>
        </div>
        <p className="text-xs text-muted">{ROLE_LABELS[role].description}</p>
      </form>

      {coHosts.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {coHosts.map((coHost) => {
            const offered = transferTo === coHost.id;
            const confirming = confirmingHandover === coHost.id;
            return (
              <li key={coHost.id} className="pl-3 pr-1">
                <div className="flex min-h-14 items-center gap-3">
                  <UserRound className="h-4 w-4 shrink-0 text-volt" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-paper">{displayName(coHost)}</span>
                    <span className="block truncate text-xs text-muted">
                      {ROLE_LABELS[coHost.role]?.label ?? coHost.role}
                      {(coHost.username || coHost.email) &&
                        ` · ${coHost.username ? `@${coHost.username}` : coHost.email}`}
                    </span>
                    {offered && (
                      <span className="mt-0.5 block text-xs text-volt">
                        Offered the event. Waiting for them to accept.
                      </span>
                    )}
                  </span>
                  {isOwner && offered && (
                    <Button variant="ghost" size="sm" onClick={() => void withdrawHandover()} disabled={busy}>
                      Withdraw offer
                    </Button>
                  )}
                  {isOwner && !offered && !transferTo && coHost.role === "manager" && !confirming && (
                    <IconButton
                      label={`Hand the event to ${displayName(coHost)}`}
                      onClick={() => setConfirmingHandover(coHost.id)}
                      disabled={busy}
                    >
                      <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  )}
                  {isOwner && (
                    <IconButton
                      tone="danger"
                      label={`Remove ${displayName(coHost)}`}
                      onClick={() => void removeCoHost(coHost.id)}
                      disabled={busy}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
                {confirming && (
                  <div className="mb-3 mr-2 rounded-xl border border-volt/30 bg-volt/10 p-3">
                    <p className="text-sm text-paper">Hand this event to {displayName(coHost)}?</p>
                    <p className="mt-1 text-xs text-muted">
                      They become the owner and you stay on as a manager. Its plan and photos stay
                      as they are. Nothing changes until they accept.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void offerHandover(coHost.id)} disabled={busy}>
                        Offer the event
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingHandover(null)} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {invites.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted">Invited, not joined yet</h3>
          <ul className="divide-y divide-canvas-line rounded-xl border border-dashed border-canvas-line">
            {invites.map((invite) => (
              <li key={invite.id} className="flex min-h-14 items-center gap-3 pl-3 pr-1">
                <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-paper">{invite.email}</span>
                  <span className="block truncate text-xs text-muted">
                    {ROLE_LABELS[invite.role]?.label ?? invite.role} {"·"} link works until{" "}
                    {new Date(invite.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </span>
                <IconButton
                  label={`Send the invitation to ${invite.email} again`}
                  onClick={(event) => void addCoHost(event, { identifier: invite.email, role: invite.role })}
                  disabled={busy}
                >
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  tone="danger"
                  label={`Withdraw the invitation to ${invite.email}`}
                  onClick={() => void withdrawInvite(invite.id)}
                  disabled={busy}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p className="text-sm text-paper" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
