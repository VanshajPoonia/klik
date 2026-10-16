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
  /** The same end date as yyyy-mm-dd, for the date field. */
  endsOn: string | null;
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

/** Months on from a plan's current end, or from today when it has none or it has passed. */
function monthsOn(endsOn: string | null, months: number): string {
  const today = new Date();
  const from = endsOn ? new Date(`${endsOn}T12:00:00`) : today;
  const base = from.getTime() < today.getTime() ? today : from;
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
}

function EntitlementItem({ row }: { row: EntitlementRow }) {
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [endsOn, setEndsOn] = useState(row.endsOn ?? "");
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

  async function saveEnd(next: string | null) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/entitlements/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // The end of that day where the admin is, not midnight UTC.
      body: JSON.stringify({ endsAt: next ? new Date(`${next}T23:59:59`).toISOString() : null, reason }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Could not change the end date");
      return;
    }
    setRenewing(false);
    setReason("");
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
          {row.status === "active" && row.scope === "account" && !revoking && !renewing && !row.inGrace && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRenewing(true)}>
              End date
            </Button>
          )}
          {row.status === "active" && row.scope === "account" && !revoking && !renewing && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void grace(row.inGrace ? "clear" : "start")}>
              {row.inGrace ? "Payment received" : "Payment failed"}
            </Button>
          )}
          {row.status === "active" && !revoking && !renewing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>
      {renewing && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            When this plan stops. Renewed, paid ahead, or cancelled from the end of this period. Nothing is charged.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 3, 12].map((months) => (
              <Button key={months} type="button" variant="ghost" size="sm" onClick={() => setEndsOn(monthsOn(row.endsOn, months))}>
                +{months} {months === 1 ? "month" : "months"}
              </Button>
            ))}
            <div className="w-full sm:w-48">
              <input
                type="date"
                aria-label="Ends on"
                className={inputClass}
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEndsOn("")}>
              No end date
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Reason for the change"
              className={inputClass}
              placeholder="Why: renewed for 3 months on 16 Oct, paid a year ahead, cancelled"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
            />
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                className="whitespace-nowrap"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void saveEnd(endsOn || null)}
              >
                {busy ? "Saving…" : endsOn ? "Save end date" : "Save with no end"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenewing(false)}>
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
      {!revoking && !renewing && error && (
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
