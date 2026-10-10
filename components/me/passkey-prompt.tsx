"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addPasskey, deviceCanHoldPasskey } from "@/lib/passkey-client";

const DISMISSED_KEY = "klik_passkey_prompt_dismissed";

/**
 * ACC-6: the moment a passkey is worth offering. A guest just signed in with a
 * code on the phone they will use next time, and this phone can hold one.
 * Offered once per phone: "Not now" is remembered here, and the account page
 * keeps the option for later.
 */
export function PasskeyPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (window.localStorage.getItem(DISMISSED_KEY)) return;
      } catch {
        // Storage blocked: offer it anyway; "Not now" then lasts this visit.
      }
      if ((await deviceCanHoldPasskey()) && live) setVisible(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to keep it in.
    }
  }

  async function add() {
    setBusy(true);
    setError(null);
    const outcome = await addPasskey();
    setBusy(false);
    if (outcome.ok) setDone(true);
    else if (outcome.error) setError(outcome.error);
  }

  if (!visible) return null;

  return (
    <Card className="mt-8">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          {done ? (
            <>
              <h2 className="text-sm font-medium text-paper">Passkey added</h2>
              <p className="mt-1 text-xs text-muted">
                Next time, choose &ldquo;Sign in with a passkey&rdquo; and use your face or fingerprint.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-medium text-paper">Sign in faster next time</h2>
              <p className="mt-1 max-w-sm text-xs text-muted">
                Save a passkey on this phone and sign in with your face or fingerprint, without waiting for a code.
              </p>
              {error && (
                <p className="mt-2 text-xs text-red-400" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void add()} disabled={busy}>
                  {busy ? "Waiting for your phone…" : "Add a passkey"}
                </Button>
                <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
                  Not now
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
