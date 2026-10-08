"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanKey } from "@/lib/plans";
import { inputClass, selectClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

interface GrantTarget {
  id: string;
  name: string;
  state: "draft" | "live" | "lapsed";
}

/**
 * ACT-2: grants a plan to one account. Replaces the old "assigned plan"
 * dropdown, which changed a single column on the account and so could not tell
 * one event from the next.
 *
 * Three decisions, in the order a superadmin makes them: what (a pass or
 * Venue), why (required, because a grant nobody can explain later is how
 * revenue disappears), and for which event. "Their next event" is the default,
 * because most grants follow a payment and the event usually does not exist
 * yet or is waiting as a draft.
 */
export function GrantControl({ userId, events }: { userId: string; events: GrantTarget[] }) {
  const router = useRouter();
  const [planKey, setPlanKey] = useState<PlanKey>("event");
  const [reason, setReason] = useState("");
  const [eventId, setEventId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const isVenue = planKey === "venue";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setOutcome(null);
    const response = await fetch(`/api/admin/clients/${userId}/entitlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey, reason, eventId: isVenue ? null : eventId || null }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(body.error ?? "Could not grant that plan");
      return;
    }

    // The email outcome, when there was one, is what to act on now, so it leads.
    const parts: string[] = [];
    if (body.notice?.message) parts.push(body.notice.message);
    if (body.licensed?.length) {
      parts.push(`${body.licensed.length} ${body.licensed.length === 1 ? "event is" : "events are"} now live.`);
    } else if (!isVenue) {
      parts.push("Saved as an unused pass. Their next event uses it.");
    }
    for (const refusal of body.refused ?? []) parts.push(refusal.reason);
    setOutcome(parts.join(" "));
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-canvas-line p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Grant a plan</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Plan"
          className={selectClass}
          value={planKey}
          onChange={(event) => setPlanKey(event.target.value as PlanKey)}
          disabled={saving}
        >
          {Object.values(PLANS).map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.key === "venue" ? `${plan.name}, account` : `${plan.name} pass, one event`}
            </option>
          ))}
        </select>
        {isVenue ? (
          <p className="self-center text-xs text-muted">
            Covers up to {PLANS.venue.maxActiveEvents} live events, including any waiting drafts.
          </p>
        ) : (
          <select
            aria-label="Which event"
            className={selectClass}
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            disabled={saving}
          >
            <option value="">Their next event</option>
            {events.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
                {target.state === "draft" ? ", waiting" : target.state === "lapsed" ? ", lapsed" : ", upgrade"}
              </option>
            ))}
          </select>
        )}
      </div>
      <input
        aria-label="Reason"
        className={inputClass}
        placeholder="Why: paid by card on 8 Oct, comp for the pilot, refund replacement"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={300}
        required
        minLength={3}
        disabled={saving}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={saving || reason.trim().length < 3}>
          {saving ? "Granting…" : "Grant"}
        </Button>
        <p
          className={`text-xs ${error ? "text-red-400" : "text-muted"}`}
          role={error ? "alert" : undefined}
          aria-live="polite"
        >
          {error ?? outcome}
        </p>
      </div>
    </form>
  );
}
