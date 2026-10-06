"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Whether this account has been told its access is open, and a way to tell them
 * again.
 *
 * The state is the useful half. Assigning a plan sends this email by itself, so
 * the button is for one situation: somebody saying they never got it. Answering
 * that needs to know whether it was ever sent, which is why the date is shown
 * rather than just offering a send.
 */
export function ActivationEmailControl({
  userId,
  email,
  activated,
  sentAt,
}: {
  userId: string;
  email: string | null;
  activated: boolean;
  /** Pre-formatted on the server: a Date here would render differently there. */
  sentAt: string | null;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  async function send() {
    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(userId)}/activation-email`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "Could not send the email. Try again.");
        return;
      }

      setJustSent(true);
      router.refresh();
    } catch {
      setError("Could not send the email. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // Before activation there is nothing to say and nothing to send. Saying so
  // beats an explanation of a button that is not there: the next thing this
  // superadmin does is assign the plan, and that sends it.
  if (!activated) {
    return (
      <p className="text-xs text-muted">
        Access email sends automatically when you assign a plan.
      </p>
    );
  }

  const status = justSent
    ? "Access email sent just now."
    : !email
      ? "No email address on file, so this account cannot be notified."
      : sentAt
        ? `Access email sent ${sentAt}.`
        : "Access email has never been sent to this account.";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p
        className={`text-xs ${
          error ? "text-red-400" : !email || (!sentAt && !justSent) ? "text-volt" : "text-muted"
        }`}
        aria-live="polite"
        role={error ? "alert" : undefined}
      >
        {error ?? status}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={sending || !email}
        onClick={send}
      >
        {sending ? "Sending…" : sentAt || justSent ? "Send again" : "Send access email"}
      </Button>
    </div>
  );
}
