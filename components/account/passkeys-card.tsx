"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import { addPasskey, passkeysSupported, syncPasskeyList } from "@/lib/passkey-client";
import type { PasskeySummary } from "@/lib/passkeys";

const LIMIT = 10;

function when(iso: string, now: number): string {
  const ago = timeAgo(iso, now);
  if (ago === "now") return "just now";
  return /^\d+[mhd]$/.test(ago) ? `${ago} ago` : `on ${ago}`;
}

/**
 * ACC-6: the account's passkeys. Add one on this device, rename them so the
 * list says which phone is which, and remove one that should not be there.
 */
export function PasskeysCard({
  initial,
  userHandle,
  now,
}: {
  initial: PasskeySummary[];
  /** The account's WebAuthn user handle, base64url, for telling this device which passkeys still work. */
  userHandle: string;
  /** The server's clock when the page was drawn, so the dates read the same before and after hydration. */
  now: number;
}) {
  const [passkeys, setPasskeys] = useState(initial);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSupported(passkeysSupported()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function add() {
    setBusy(true);
    setMessage(null);
    const outcome = await addPasskey();
    setBusy(false);
    if (outcome.ok) {
      setPasskeys((list) => [...list, outcome.passkey]);
      setMessage({ tone: "ok", text: `Added. Next time, choose "Sign in with a passkey".` });
    } else if (outcome.error) {
      setMessage({ tone: "error", text: outcome.error });
    }
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const { id, name } = renaming;
    setBusy(true);
    const result = await apiRequest<{ name: string }>(
      `/api/passkeys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: { name } },
      "Could not rename it",
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setPasskeys((list) => list.map((passkey) => (passkey.id === id ? { ...passkey, name: result.data.name } : passkey)));
    setRenaming(null);
    setMessage(null);
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await apiRequest(`/api/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }, "Could not remove it");
    setBusy(false);
    setConfirming(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    const remaining = passkeys.filter((passkey) => passkey.id !== id);
    setPasskeys(remaining);
    setMessage({ tone: "ok", text: "Removed. It cannot sign in any more." });
    void syncPasskeyList(
      userHandle,
      remaining.map((passkey) => passkey.id),
    );
  }

  return (
    <section id="passkeys" className="space-y-3" aria-labelledby="passkeys-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-sm">
          <h2 id="passkeys-heading" className="text-sm font-medium text-paper">
            Passkeys
          </h2>
          <p className="mt-1 text-xs text-muted">
            Sign in with your face, fingerprint or your phone&apos;s PIN. Nothing to type, no code to wait for.
          </p>
        </div>
        {supported && (
          <Button size="sm" variant="ghost" onClick={() => void add()} disabled={busy || passkeys.length >= LIMIT}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Add a passkey
          </Button>
        )}
      </div>

      {supported === false && (
        <p className="text-xs text-muted">This browser cannot make passkeys. Open this page on your phone to add one.</p>
      )}

      {passkeys.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              {renaming?.id === passkey.id ? (
                <form onSubmit={(event) => void rename(event)} className="flex w-full flex-wrap items-center gap-2">
                  <label htmlFor={`passkey-name-${passkey.id}`} className="sr-only">
                    Passkey name
                  </label>
                  <input
                    id={`passkey-name-${passkey.id}`}
                    className={`${inputClass} min-w-0 flex-1`}
                    value={renaming.name}
                    onChange={(event) => setRenaming({ id: passkey.id, name: event.target.value })}
                    maxLength={60}
                    autoFocus
                    required
                  />
                  <Button type="submit" size="sm" disabled={busy || !renaming.name.trim()}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-paper">{passkey.name}</span>
                    <span className="block text-xs text-muted">
                      {passkey.synced ? "Synced to your other devices" : "On one device only"}
                      {" · "}
                      {passkey.lastUsedAt ? `Last used ${when(passkey.lastUsedAt, now)}` : `Added ${when(passkey.createdAt, now)}`}
                    </span>
                  </span>
                  {confirming === passkey.id ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted">Remove it?</span>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(passkey.id)}>
                        Remove
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: passkey.id, name: passkey.name })}>
                        Rename
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(passkey.id)}>
                        Remove
                      </Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-red-400"}`} role={message.tone === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
