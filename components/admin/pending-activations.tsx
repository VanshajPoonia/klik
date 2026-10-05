import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PLANS } from "@/lib/plans";
import type { getPendingActivations } from "@/lib/billing-admin";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * The gap between money arriving and access being granted.
 *
 * Deliberately read-only. Activation happens through the existing plan control
 * further down the page, so there is one way to grant a plan rather than two
 * that can disagree. This panel exists to make sure nobody who has paid is
 * waiting without anyone knowing.
 */
export function PendingActivations({
  pending,
}: {
  pending: Awaited<ReturnType<typeof getPendingActivations>>;
}) {
  const { unusedPasses, venueDrift } = pending;
  if (unusedPasses.length === 0 && venueDrift.length === 0) return null;

  return (
    <Card className="mb-8 space-y-4 border-volt/30">
      <div className="flex items-center gap-2.5">
        <h2 className="font-display text-lg text-paper">Paid, awaiting activation</h2>
        <Badge>{unusedPasses.length + venueDrift.length}</Badge>
      </div>

      {unusedPasses.length > 0 && (
        <ul className="space-y-2">
          {unusedPasses.map((pass) => (
            <li
              key={pass.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border-t border-canvas-line pt-2 text-sm"
            >
              <span className="text-paper">
                {pass.contactName ?? pass.username ?? pass.userId}
              </span>
              <span className="text-xs text-muted">
                {PLANS[pass.planKey].name}, {money(pass.amountCents, pass.currency)}, bought{" "}
                {pass.createdAt.toLocaleDateString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {venueDrift.length > 0 && (
        <ul className="space-y-2">
          {venueDrift.map((row) => (
            <li
              key={row.userId}
              className="flex flex-wrap items-baseline justify-between gap-2 border-t border-canvas-line pt-2 text-sm"
            >
              <span className="text-paper">
                {row.contactName ?? row.username ?? row.userId}
              </span>
              <span className="text-xs text-muted">
                Paying for Venue ({row.status}), account is on {PLANS[row.planKey].name}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        Payments are recorded automatically. Granting a plan is still a decision you make, using
        the controls below.
      </p>
    </Card>
  );
}
