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

  async function updatePlan(nextPlanKey: PlanKey) {
    const previousPlanKey = planKey;
    setPlanKey(nextPlanKey);
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/admin/clients/${userId}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey: nextPlanKey }),
    });

    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setPlanKey(previousPlanKey);
      setError(body.error ?? "Could not update the plan");
      return;
    }

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
      <p className={`mt-1.5 text-xs ${error ? "text-red-400" : "text-muted"}`} aria-live="polite">
        {error ?? (saving ? "Saving plan…" : `${PLANS[planKey].maxActiveEvents} active event limit`)}
      </p>
    </div>
  );
}
