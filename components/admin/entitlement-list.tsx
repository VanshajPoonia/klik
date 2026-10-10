"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface EntitlementRow {
  id: string;
  planName: string;
  scope: "event" | "account";
  status: "active" | "revoked";
  spentOn: string | null;
  spent: boolean;
  reason: string | null;
  grantedBy: string | null;
  createdAt: string;
  endsAt: string | null;
  revokeReason: string | null;
  /** PAY-5: what was recorded as paid, as words ("$39", "comp"), or null when unknown. */
  paid: string | null;
  /** PAY-8: a failed payment's grace is running. */
  inGrace: boolean;
}

/**
 * Everything an account has been granted, revoked rows included, newest first.
 * A grant is never edited or deleted: a correction is a new grant, and taking
 * one back is a revocation with a reason, so this list is the whole history.
 */
export function EntitlementList({ rows }: { rows: EntitlementRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-canvas-line px-4 py-3 text-sm text-muted">
        Nothing granted yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
      {rows.map((row) => (
        <EntitlementItem key={row.id} row={row} />
      ))}
    </ul>
  );
}

function EntitlementItem({ row }: { row: EntitlementRow }) {
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grace(action: "start" | "clear") {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/entitlements/${row.id}/grace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Could not change that");
      return;
    }
    router.refresh();
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/entitlements/${row.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Could not revoke");
      return;
    }
    setRevoking(false);
    router.refresh();
  }

  const label = row.scope === "account" ? row.planName : `${row.planName} pass`;
  const state =
    row.status === "revoked" ? "revoked" : row.scope === "event" ? (row.spent ? "used" : "unused") : "active";

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-paper">
            {label}
            {row.spentOn && <span className="font-normal text-muted"> · {row.spentOn}</span>}
          </p>
          <p className="text-xs text-muted">
            {row.createdAt}
            {row.grantedBy ? ` by ${row.grantedBy}` : ""}
            {row.endsAt ? `, until ${row.endsAt}` : ""}
            {row.paid ? `. ${row.paid}` : ""}
            {row.reason ? `. ${row.reason}` : ""}
          </p>
          {row.revokeReason && <p className="text-xs text-red-400">Revoked: {row.revokeReason}</p>}
          {row.inGrace && row.status === "active" && (
            <p className="text-xs text-amber-300">
              Payment failed. Working until {row.endsAt}, then it lapses unless the payment is recorded. The organizer
              is emailed now, on day 3 and on day 6.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={state === "revoked" ? "danger" : state === "unused" ? "warning" : "volt"}>{state}</Badge>
          {/* PAY-8: only a Venue grant renews, so only it can fail to. */}
          {row.status === "active" && row.scope === "account" && !revoking && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void grace(row.inGrace ? "clear" : "start")}>
              {row.inGrace ? "Payment received" : "Payment failed"}
            </Button>
          )}
          {row.status === "active" && !revoking && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>
      {!revoking && error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      {revoking && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Its events stop taking uploads. Guests keep seeing the gallery for the rest of its window.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Reason for revoking"
              className={inputClass}
              placeholder="Why: refunded on 9 Oct, chargeback, comp ended"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void revoke()}
              >
                {busy ? "Revoking…" : "Revoke"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(false)}>
                Cancel
              </Button>
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
