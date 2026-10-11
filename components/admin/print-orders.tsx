"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface PrintOrderRow {
  id: string;
  status: string;
  eventName: string | null;
  email: string | null;
  address: string | null;
  totalCents: number;
  paid: string | null;
  stage: string | null;
  error: string | null;
  lines: Array<{ thumb: string | null; label: string; copies: number; quality: string; missing: boolean }>;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * GRW-6: paid print orders, each waiting for a person to send it to Prodigi
 * or refund it, then the most recent others. Shown once prints are switched
 * on. Every photo is on the card, so nothing is printed unseen.
 */
export function PrintOrders({ waiting, recent, live }: { waiting: PrintOrderRow[]; recent: PrintOrderRow[]; live: boolean }) {
  const [catalogue, setCatalogue] = useState<Array<{ key: string; sku: string; ok: boolean; detail: string }> | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkCatalogue() {
    setChecking(true);
    const response = await fetch("/api/admin/prints/catalogue", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { products?: typeof catalogue };
    setCatalogue(body?.products ?? []);
    setChecking(false);
  }

  return (
    <Card className="mb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-paper">Print orders</h2>
        <div className="flex items-center gap-2">
          <Badge tone={live ? "warning" : "neutral"}>{live ? "Prodigi live" : "Prodigi sandbox"}</Badge>
          {waiting.length > 0 && <Badge tone="danger">{waiting.length} to review</Badge>}
          <Button variant="ghost" size="sm" disabled={checking} onClick={() => void checkCatalogue()}>
            {checking ? "Checking…" : "Check the catalogue"}
          </Button>
        </div>
      </div>
      {catalogue && (
        <ul className="space-y-1 text-xs">
          {catalogue.map((product) => (
            <li key={product.key} className={product.ok ? "text-muted" : "text-red-400"}>
              {product.ok ? "OK" : "Problem"}: {product.key} ({product.sku}). {product.detail}
            </li>
          ))}
        </ul>
      )}
      {waiting.length === 0 ? (
        <p className="text-sm text-muted">Nothing waiting.</p>
      ) : (
        <ul className="space-y-3">
          {waiting.map((row) => (
            <PrintOrderItem key={row.id} row={row} />
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Recent orders</summary>
          <ul className="mt-2 space-y-1">
            {recent.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-2 text-xs text-muted">
                <span className="font-mono text-paper">{row.id}</span>
                <span>{row.status}</span>
                {row.stage && <span>Prodigi: {row.stage}</span>}
                <span>{money(row.totalCents)}</span>
                {row.eventName && <span>{row.eventName}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function PrintOrderItem({ row }: { row: PrintOrderRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const missing = row.lines.some((line) => line.missing);

  async function act(action: "quote" | "submit" | "refund") {
    setBusy(action);
    setError(null);
    const response = await fetch(`/api/admin/prints/${row.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "refund" ? { action, note } : action === "submit" ? { action, note: note || undefined } : { action }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string; cost?: { totalCents: number; currency: string } | null };
    setBusy(null);
    if (!response?.ok) {
      setError(body?.error ?? "That did not work");
      return;
    }
    if (action === "quote") {
      setCost(body.cost ? `Prodigi charges ${money(body.cost.totalCents)} ${body.cost.currency}, so Klik keeps about ${money(row.totalCents - body.cost.totalCents)} before Stripe's fee.` : "Prodigi gave no price.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="space-y-3 rounded-xl border border-canvas-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div className="min-w-0">
          <p className="text-paper">
            <span className="font-mono">{row.id}</span> · {money(row.totalCents)} · paid {row.paid}
          </p>
          <p className="text-xs text-muted">
            {row.eventName ?? "A deleted event"} · {row.email ?? "no email"} · {row.address ?? "no address"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.lines.map((line, index) => (
          <div key={index} className="w-24 space-y-1 text-[11px] text-muted">
            <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-canvas-line bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed and short-lived */}
              {line.thumb && <img src={line.thumb} alt="" className="h-full w-full object-cover" />}
            </div>
            <p className={line.missing ? "text-red-400" : line.quality === "soft" ? "text-red-300" : ""}>
              {line.label} × {line.copies}
              {line.missing ? ", gone" : line.quality === "soft" ? ", may print soft" : ""}
            </p>
          </div>
        ))}
      </div>
      {missing && <p className="text-xs text-red-400">A photo in this order was deleted or held since. Refund it.</p>}
      {cost && <p className="text-xs text-muted">{cost}</p>}
      <input
        aria-label="Note"
        className={inputClass}
        placeholder="Note for the record. Required to refund, and the reason the buyer may ask for."
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null || missing} onClick={() => void act("submit")}>
          {busy === "submit" ? "Sending…" : "Send to the printer"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void act("quote")}>
          {busy === "quote" ? "Asking…" : "What will Prodigi charge?"}
        </Button>
        <Button variant="danger" size="sm" disabled={busy !== null || note.trim().length < 3} onClick={() => void act("refund")}>
          {busy === "refund" ? "Refunding…" : "Refund in full"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
