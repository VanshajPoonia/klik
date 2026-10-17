"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/field";

/**
 * ADM-7: put an event on another account. The gallery, its photos, its QR and
 * its licence go with it; the new owner is emailed.
 */
export function MoveEventControl({
  eventId,
  eventName,
  ownerIsKlik,
}: {
  eventId: string;
  eventName: string;
  /** Klik can open every event anyway, so keeping it on the team adds nothing. */
  ownerIsKlik: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [keep, setKeep] = useState(!ownerIsKlik);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, keepPreviousOwner: keep }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not move it");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not move it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-paper" role="status">
        Moved. &ldquo;{eventName}&rdquo; is on their account now, and they have been emailed.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs text-muted">Move &ldquo;{eventName}&rdquo; to</span>
        <input
          className={inputClass}
          value={to}
          onChange={(change) => setTo(change.target.value)}
          placeholder="Their email or @handle"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      {!ownerIsKlik && (
        <Checkbox checked={keep} onChange={(change) => setKeep(change.target.checked)}>
          Keep this account on the event&apos;s team as a manager
        </Checkbox>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={saving || !to.trim()}>
        {saving ? "Moving…" : "Move the event"}
      </Button>
    </form>
  );
}
