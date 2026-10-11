"use client";

import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface DomainView {
  hostname: string;
  active: boolean;
  verified: boolean;
  configured: boolean;
  records: Array<{ type: string; name: string; value: string }>;
  verification: Array<{ type: string; name: string; value: string }>;
  checkedAt: string | null;
}

/**
 * VEN-3: the venue's own domain. Add it, set the records shown at the DNS
 * provider, and Klik checks until it is live; from then on the venue QR code
 * and link use it.
 */
export function CustomDomainCard({ initial }: { initial: DomainView | null }) {
  const [domain, setDomain] = useState<DomainView | null>(initial);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState<"add" | "check" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function send(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    const response = await fetch("/api/me/domain", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const json = (await response?.json().catch(() => ({}))) as { error?: string; domain?: DomainView } | undefined;
    if (!response?.ok) {
      setError(json?.error ?? "That did not work. Try again.");
      return null;
    }
    return json ?? {};
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy("add");
    setError(null);
    const result = await send("POST", { hostname });
    setBusy(null);
    if (result?.domain) setDomain(result.domain);
  }

  async function check() {
    setBusy("check");
    setError(null);
    const result = await send("PATCH");
    setBusy(null);
    if (result?.domain) setDomain(result.domain);
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    const result = await send("DELETE");
    setBusy(null);
    setConfirming(false);
    if (result) setDomain(null);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Shown on screen to copy by hand.
    }
  }

  const records = domain ? [...domain.verification, ...domain.records] : [];

  return (
    <Card className="mb-10 space-y-4">
      <div>
        <h2 className="font-display text-xl text-paper">Your own address</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Put your galleries on an address like photos.yourvenue.com. Guests see your name in the address bar,
          and your venue QR code and link switch to it once it is live. Signing in stays on Klik.
        </p>
      </div>

      {!domain && (
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="custom-domain" className="sr-only">
            Domain
          </label>
          <input
            id="custom-domain"
            className={inputClass}
            placeholder="photos.yourvenue.com"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={253}
          />
          <Button type="submit" disabled={busy !== null || hostname.trim().length < 4}>
            {busy === "add" ? "Adding…" : "Add domain"}
          </Button>
        </form>
      )}

      {domain && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-paper">{domain.hostname}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                domain.active ? "bg-volt text-on-volt" : "border border-canvas-line text-muted"
              }`}
            >
              {domain.active ? "Live" : "Waiting for DNS"}
            </span>
          </div>

          {domain.active ? (
            <p className="text-sm text-muted">
              Guests can open{" "}
              <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer" className="text-paper underline underline-offset-2">
                https://{domain.hostname}
              </a>{" "}
              and land on your featured live gallery.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                Add {records.length === 1 ? "this record" : "these records"} where your domain&apos;s DNS is managed (your
                registrar, or a service like Cloudflare), then check again. DNS can take a few minutes, sometimes an hour.
                Klik also checks once a day by itself.
              </p>
              <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
                {records.map((record) => (
                  <li key={`${record.type}:${record.name}:${record.value}`} className="flex items-start gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-xs text-muted">
                        <span className="font-mono text-paper">{record.type}</span> record, name{" "}
                        <span className="font-mono text-paper">{record.name}</span>, value:
                      </p>
                      <p className="break-all font-mono text-sm text-paper">{record.value}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copy(record.value)}
                      className="min-h-11 shrink-0 rounded-full border border-canvas-line px-3 text-xs text-paper transition-colors hover:border-volt/50 hover:text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                      aria-label={`Copy the ${record.type} value`}
                    >
                      {copied === record.value ? "Copied" : "Copy"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {!domain.active && (
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void check()}>
                {busy === "check" ? "Checking…" : "Check again"}
              </Button>
            )}
            {confirming ? (
              <>
                <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => void remove()}>
                  {busy === "remove" ? "Removing…" : "Remove it"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Remove domain
              </Button>
            )}
          </div>
          {confirming && (
            <p className="text-xs text-muted">
              The address stops working at once. Signs and QR codes printed with it will stop opening your gallery.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
