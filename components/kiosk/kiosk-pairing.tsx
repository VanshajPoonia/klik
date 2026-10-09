"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";

/** VEN-2: the one tap that turns this device into a kiosk. */
export function KioskPairing({
  code,
  eventName,
  kioskName,
  signedInAs,
  signOut,
}: {
  code: string;
  eventName: string;
  kioskName: string;
  /** Someone is signed in on this device, which a guest at the kiosk could reach. */
  signedInAs: string | null;
  signOut?: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pair() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kiosk/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not work. Try again.");
      router.replace(`/e/${body.slug}/kiosk`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <Tablet className="h-10 w-10 text-volt" aria-hidden="true" />
      <h1 className="mt-5 max-w-md font-display text-3xl text-paper">Make this device a kiosk for {eventName}?</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        It becomes &ldquo;{kioskName}&rdquo;: guests tap it, take a photo, and it goes into the gallery. It cannot browse
        the gallery or change anything. Switch it off any time from the event&apos;s QR code tab.
      </p>
      {signedInAs && (
        <div className="mt-5 max-w-md space-y-3 rounded-2xl border border-canvas-line bg-canvas-raised px-4 py-3 text-left text-sm leading-relaxed text-paper">
          <p>
            You are signed in here as {signedInAs}. The kiosk does not use your account, but a guest who leaves the
            kiosk screen could reach it. Sign out first on a device you are leaving at the venue.
          </p>
          {signOut}
        </div>
      )}
      <Button className="mt-8" onClick={() => void pair()} disabled={busy}>
        {busy ? "Setting up…" : "Make it a kiosk"}
      </Button>
      {error && (
        <p className="mt-4 max-w-sm text-sm text-muted" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
