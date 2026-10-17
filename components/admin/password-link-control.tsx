"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * ACC-8: emails the account a link to choose its own password, instead of a
 * password a superadmin passes on by hand. Their current password keeps
 * working until they choose one.
 */
export function PasswordLinkControl({ userId, email, compact = false }: { userId: string; email: string; compact?: boolean }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(userId)}/password-link`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "Could not send the email. Try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Could not send the email. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-2 border-t border-canvas-line pt-4"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {sent
            ? `Sent to ${email}. The link works once, for seven days; sending again replaces it.`
            : `Email ${email} a link to choose their own password. Their current one keeps working until they do.`}
        </p>
        <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => void send()}>
          {sending ? "Sending" : sent ? "Send again" : "Email a link to choose a password"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
