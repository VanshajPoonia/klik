"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

/**
 * TRS-2 on a client card: erase the account, for a deletion request made to
 * Klik by email or phone. Immediate and permanent, so it takes the account's
 * username or email typed back and a reason, both kept in the erasure log.
 */
export function EraseClientControl({ userId, confirmWith }: { userId: string; confirmWith: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest(
      `/api/admin/clients/${userId}`,
      { method: "DELETE", body: { confirm: typed, reason } },
      "Could not erase this account",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted underline underline-offset-2 hover:text-paper">
        Erase this account
      </button>
    );
  }

  return (
    <form onSubmit={(event) => void erase(event)} className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
      <p className="text-sm text-paper">
        Erase this account, every event it owns and every photo guests shared to them, now. For a deletion request
        they made to us. It cannot be undone.
      </p>
      <label className="block text-xs text-muted" htmlFor={`erase-client-${userId}`}>
        Type {confirmWith} to confirm
      </label>
      <input id={`erase-client-${userId}`} className={inputClass} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
      <label className="block text-xs text-muted" htmlFor={`erase-reason-${userId}`}>
        Reason, kept in the erasure log
      </label>
      <input
        id={`erase-reason-${userId}`}
        className={inputClass}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Deletion requested by email on 10 October"
        maxLength={500}
      />
      {error && (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          size="sm"
          disabled={busy || typed.trim().toLowerCase() !== confirmWith.toLowerCase() || reason.trim().length < 3}
        >
          {busy ? "Erasing…" : "Erase for good"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
