"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

/** ACC-8: the form behind an emailed link to choose a password. */
export function ChoosePasswordForm({ token, username, min }: { token: string; username: string | null; min: number }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < min) {
      setError(`At least ${min} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "That did not work. Try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach Klik. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <p className="text-sm text-paper" role="status">
          Your password is set.{username ? ` Sign in as @${username} with it.` : ""}
        </p>
        <Link href="/login" className={buttonClassName({ className: "w-full" })}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 text-left">
      {username && (
        <p className="text-center text-sm text-muted">
          For <span className="font-medium text-paper">@{username}</span>
        </p>
      )}
      <Field label="New password" htmlFor="new-password" hint={`At least ${min} characters. A few words you will remember work well.`}>
        <PasswordInput
          id="new-password"
          value={password}
          onChange={(change) => setPassword(change.target.value)}
          autoComplete="new-password"
          minLength={min}
          maxLength={72}
          required
          autoFocus
        />
      </Field>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving" : "Set my password"}
      </Button>
    </form>
  );
}
