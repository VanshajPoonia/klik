"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanKey } from "@/lib/plans";
import { inputClass } from "@/components/ui/field";

export function PlanAssignmentControl({
  userId,
  initialPlanKey,
}: {
  userId: string;
  initialPlanKey: PlanKey;
}) {
  const router = useRouter();
  const [planKey, setPlanKey] = useState(initialPlanKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What happened to the access email this assignment triggered.
   *
   * Shown here rather than left to the panel below, because a plan granted and
   * an email that did not send is one action with two outcomes, and the person
   * who can do something about the second is the one who just clicked. Null when
   * the account was already active, where no email is sent by design.
   */
  const [notice, setNotice] = useState<{ sent: boolean; message: string } | null>(null);

  async function updatePlan(nextPlanKey: PlanKey) {
    const previousPlanKey = planKey;
    setPlanKey(nextPlanKey);
    setSaving(true);
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/admin/clients/${userId}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey: nextPlanKey }),
    });

    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setPlanKey(previousPlanKey);
      setError(body.error ?? "Could not update the plan");
      return;
    }

    if (body.notice) setNotice(body.notice);
    router.refresh();
  }

  return (
    <div>
      <label htmlFor={`plan-${userId}`} className="mb-1.5 block text-xs font-medium text-muted">
        Assigned plan
      </label>
      <select
        id={`plan-${userId}`}
        className={`${inputClass} sm:max-w-64`}
        value={planKey}
        disabled={saving}
        onChange={(event) => void updatePlan(event.target.value as PlanKey)}
      >
        {Object.values(PLANS).map((plan) => (
          <option key={plan.key} value={plan.key}>
            {plan.name}
          </option>
        ))}
      </select>
      <p
        className={`mt-1.5 text-xs ${
          error ? "text-red-400" : notice && !notice.sent ? "text-volt" : "text-muted"
        }`}
        aria-live="polite"
        role={error ? "alert" : undefined}
      >
        {error ??
          (saving
            ? "Saving plan…"
            : // The email outcome outranks the plan limits once there is one.
              // Limits are reference material the superadmin can re-read any
              // time; a send that failed is a thing to act on now.
              (notice?.message ??
                `${PLANS[planKey].maxActiveEvents} active, ${PLANS[planKey].maxEventsPerMonth} per month`))}
      </p>
    </div>
  );
}
