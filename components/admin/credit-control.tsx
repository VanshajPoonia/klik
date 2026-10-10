"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

function dollars(cents: number) {
  const value = cents / 100;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/**
 * GRW-5 on a client card: who referred them, the credit they hold, and a way
 * to record using it. Using credit is done in Stripe first (a partial refund
 * of their payment); this records it, with the reason, on their ledger.
 */
export function CreditControl({
  userId,
  balanceCents,
  referredBy,
}: {
  userId: string;
  balanceCents: number;
  referredBy: { name: string; qualified: boolean } | null;
}) {
  const [balance, setBalance] = useState(balanceCents);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (balance === 0 && !referredBy) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<{ balanceCents: number }>(
      `/api/admin/clients/${userId}/credits`,
      { method: "POST", body: { amountCents: cents, reason } },
      "Could not record that",
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setBalance(result.data.balanceCents);
    setAmount("");
    setReason("");
    setOpen(false);
    setMessage({ tone: "ok", text: `Recorded. ${dollars(result.data.balanceCents)} left.` });
  }

  return (
    <div className="space-y-2 rounded-xl border border-canvas-line px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-paper">
          Credit <span className="font-medium tabular-nums">{dollars(balance)}</span>
          {referredBy && (
            <span className="text-muted">
              {" "}
              · referred by {referredBy.name}
              {referredBy.qualified ? "" : " (pays out at their first grant)"}
            </span>
          )}
        </p>
        {balance > 0 && !open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Use credit
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`credit-amount-${userId}`}>
            Amount in dollars
          </label>
          <input
            id={`credit-amount-${userId}`}
            className={`${inputClass} w-24`}
            inputMode="decimal"
            placeholder="10"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            required
          />
          <label className="sr-only" htmlFor={`credit-reason-${userId}`}>
            What it was used for
          </label>
          <input
            id={`credit-reason-${userId}`}
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="Refunded $10 of their Premium payment in Stripe"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            required
          />
          <Button type="submit" size="sm" disabled={busy || !amount || reason.trim().length < 3}>
            Record
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
      {message && (
        <p className={`text-xs ${message.tone === "ok" ? "text-muted" : "text-red-400"}`} role={message.tone === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
