"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { PASSWORD_MIN } from "@/lib/signup";

interface ResetResult {
  username: string;
  password: string;
}

export function ResetPasswordControl({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // ADM-7: a password of the superadmin's choosing, or empty for a generated one.
  const [chosen, setChosen] = useState("");

  async function resetPassword() {
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(userId)}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chosen ? { password: chosen } : {}),
        },
      );
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "Password could not be reset. Try again.");
        return;
      }

      if (
        !data ||
        typeof data.username !== "string" ||
        typeof data.password !== "string"
      ) {
        setError("The password was reset, but the new credentials could not be displayed.");
        return;
      }

      setResult(data as ResetResult);
      setConfirming(false);
      setChosen("");
    } catch {
      setError("Password could not be reset. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCredentials() {
    if (!result) return;

    const credentials = [
      "Klik login",
      `URL: ${window.location.origin}/login`,
      `Username: ${result.username}`,
      `Password: ${result.password}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(credentials);
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Copy the password shown above.");
    }
  }

  if (result) {
    return (
      <div
        className="space-y-3 border-t border-canvas-line pt-4"
        aria-live="polite"
      >
        <div className="rounded-xl border border-volt/30 bg-volt/5 p-4">
          <p className="text-sm font-semibold text-volt">Password changed</p>
          <p className="mt-1 text-xs text-muted">
            This password is shown once. Copy it now. Existing client sessions have also been
            revoked.
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Username</dt>
              <dd className="mt-0.5 font-mono text-paper">{result.username}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">New password</dt>
              <dd className="mt-0.5 select-all font-mono text-paper">{result.password}</dd>
            </div>
          </dl>
        </div>
        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" onClick={copyCredentials}>
            {copied ? "Copied!" : "Copy credentials"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setResult(null);
              setError(null);
              setCopied(false);
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-canvas-line pt-4">
      {confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-paper">Change @{username}&apos;s password?</p>
            <p className="mt-0.5 text-xs text-muted">
              Their current password will stop working and signed-in sessions will be revoked.
            </p>
            <label className="mt-3 block max-w-xs">
              <span className="sr-only">New password</span>
              <input
                type="text"
                className={inputClass}
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                placeholder="Type one, or leave empty for a generated one"
                autoComplete="off"
                spellCheck={false}
                maxLength={72}
              />
            </label>
            {chosen && chosen.length < PASSWORD_MIN && (
              <p className="mt-1 text-xs text-muted">At least {PASSWORD_MIN} characters.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={loading || (chosen.length > 0 && chosen.length < PASSWORD_MIN)}
              onClick={resetPassword}
            >
              {loading ? "Saving..." : chosen ? "Set this password" : "Generate one"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Change password
          </Button>
        </div>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
