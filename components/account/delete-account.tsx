"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

/**
 * Account erasure, which `DELETE /api/me` has done since SEC-4 with nothing on
 * screen to reach it. Permanent and immediate: no trash, no 30 days.
 */
export function DeleteAccount({ confirmWith }: { confirmWith: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/me`, { method: "DELETE", body: { confirm: typed } }, "Could not delete your account");
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    await signOut({ redirectTo: "/" });
  }

  const matches = typed.trim().toLowerCase() === confirmWith.toLowerCase();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-paper">Delete your account</h2>
        <p className="mt-1 text-xs text-muted">
          Erases your account, every event you own, and every photo and video guests shared to them,
          straight away. It cannot be undone, and there is no refund for passes left unused. Events
          you only help run are not affected.
        </p>
      </div>
      {!open ? (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <form onSubmit={erase} className="space-y-3">
          <Field label={`Type ${confirmWith} to confirm`}>
            <input
              className={inputClass}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={busy || !matches}>
              {busy ? "Deleting…" : "Delete everything"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
