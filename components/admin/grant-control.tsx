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
/** The usual reasons, one tap each. Typing one of your own still works. */
const QUICK_REASONS = ["Paid by card", "Paid by bank transfer", "Comp", "Pilot client", "Upgrade"] as const;

export function GrantControl({
  userId,
  events,
  target,
}: {
  userId: string;
  events: GrantTarget[];
  /** One event this form puts live, with no picker: the "Go live" form beside a waiting event. */
  target?: GrantTarget;
}) {
  const router = useRouter();
  const [planKey, setPlanKey] = useState<PlanKey>("event");
  const [reason, setReason] = useState("");
  const [eventId, setEventId] = useState(target?.id ?? "");
  // PAY-5, ADM-2: what was paid. The list price unless it was a comp or a deal.
  const [payment, setPayment] = useState<"paid" | "comp">("paid");
  const [amount, setAmount] = useState("");
  const [stripeRef, setStripeRef] = useState("");
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
      body: JSON.stringify({
        planKey,
        reason,
        eventId: isVenue ? null : eventId || null,
        amountCents: payment === "comp" ? 0 : Math.round(Number(amount || PLANS[planKey].priceCents / 100) * 100),
        stripeRef: payment === "paid" && stripeRef.trim() ? stripeRef.trim() : undefined,
      }),
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
    setAmount("");
    setStripeRef("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-canvas-line p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        {target ? (target.state === "live" ? `Upgrade ${target.name}` : `Put ${target.name} live`) : "Grant a plan"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Plan"
          className={selectClass}
          value={planKey}
          onChange={(event) => setPlanKey(event.target.value as PlanKey)}
          disabled={saving}
        >
          {/* A Venue grant covers every draft, so it is granted from the account, not one event. */}
          {Object.values(PLANS).filter((plan) => !target || plan.key !== "venue").map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.key === "venue" ? `${plan.name}, account` : `${plan.name} pass, one event`}
            </option>
          ))}
        </select>
        {target ? (
          <p className="self-center text-xs text-muted">
            {target.state === "draft" ? "Licenses this event and puts it live." : "Moves this event onto the new pass."}
          </p>
        ) : isVenue ? (
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
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-paper">
        <legend className="sr-only">Payment</legend>
        <label className="flex min-h-10 items-center gap-2 whitespace-nowrap">
          <input type="radio" name={`payment-${userId}`} checked={payment === "paid"} onChange={() => setPayment("paid")} disabled={saving} />
          Paid $
          <input
            aria-label="Amount paid in dollars"
            className={`${inputClass} w-24`}
            inputMode="decimal"
            placeholder={String(PLANS[planKey].priceCents / 100)}
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            disabled={saving || payment !== "paid"}
          />
        </label>
        <label className="flex min-h-10 items-center gap-2 whitespace-nowrap">
          <input type="radio" name={`payment-${userId}`} checked={payment === "comp"} onChange={() => setPayment("comp")} disabled={saving} />
          Comp, nothing paid
        </label>
        {payment === "paid" && (
          <input
            aria-label="Stripe payment reference, optional"
            className={`${inputClass} min-w-0 sm:w-auto sm:flex-1`}
            placeholder="Stripe payment or receipt number (optional)"
            value={stripeRef}
            onChange={(event) => setStripeRef(event.target.value)}
            maxLength={120}
            disabled={saving}
          />
        )}
      </fieldset>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick reasons">
        {QUICK_REASONS.map((quick) => (
          <button
            key={quick}
            type="button"
            onClick={() => {
              setReason(quick);
              if (quick === "Comp" || quick === "Pilot client") setPayment("comp");
              else if (quick.startsWith("Paid")) setPayment("paid");
            }}
            disabled={saving}
            aria-pressed={reason === quick}
            className="min-h-8 rounded-full border border-canvas-line px-3 text-xs text-muted transition-colors hover:border-paper/40 hover:text-paper aria-pressed:border-volt aria-pressed:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            {quick}
          </button>
        ))}
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
          {saving ? "Granting…" : target?.state === "draft" || target?.state === "lapsed" ? "Go live" : "Grant"}
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
