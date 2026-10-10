import type { PlanKey } from "./plans";
import { PLANS } from "./plans";

/**
 * ADM-2: revenue, from what superadmins recorded when granting. Klik takes
 * payment through hosted Stripe links and never sees the money, so this is
 * the ledger's account of it, not Stripe's: a grant made before amounts were
 * kept counts as "not recorded", and Stripe's Dashboard stays the record of
 * money. Pure, so it is tested without a database.
 */

export type RevenueGrant = {
  planKey: PlanKey;
  scope: "event" | "account";
  status: "active" | "revoked";
  amountCents: number | null;
  createdAt: Date;
  endsAt: Date | null;
  graceStartedAt: Date | null;
};

export type MonthRow = { month: string; paidCents: number; paidCount: number; comps: number; notRecorded: number };

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export function summarizeRevenue(grants: RevenueGrant[], now = new Date(), months = 12) {
  const keys: string[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))));
  }
  const byMonth = new Map<string, MonthRow>(keys.map((month) => [month, { month, paidCents: 0, paidCount: 0, comps: 0, notRecorded: 0 }]));
  const byPlan = new Map<PlanKey, { paidCents: number; paidCount: number }>();

  for (const grant of grants) {
    const row = byMonth.get(monthKey(grant.createdAt));
    if (row) {
      if (grant.amountCents === null) row.notRecorded += 1;
      else if (grant.amountCents === 0) row.comps += 1;
      else {
        row.paidCents += grant.amountCents;
        row.paidCount += 1;
      }
    }
    if (grant.amountCents && monthKey(grant.createdAt) === keys[keys.length - 1]) {
      const plan = byPlan.get(grant.planKey) ?? { paidCents: 0, paidCount: 0 };
      plan.paidCents += grant.amountCents;
      plan.paidCount += 1;
      byPlan.set(grant.planKey, plan);
    }
  }

  // A Venue grant renews monthly until it ends: running ones are what recurs.
  const venue = grants.filter(
    (grant) => grant.scope === "account" && grant.status === "active" && (grant.endsAt === null || grant.endsAt > now),
  );
  const inGrace = venue.filter((grant) => grant.graceStartedAt !== null).length;
  const monthly = venue.reduce((total, grant) => total + (grant.amountCents && grant.amountCents > 0 ? grant.amountCents : PLANS.venue.priceCents), 0);

  const thisMonth = byMonth.get(keys[keys.length - 1])!;
  return {
    thisMonth,
    months: keys.map((key) => byMonth.get(key)!),
    byPlan: [...byPlan.entries()].map(([planKey, totals]) => ({ planKey, ...totals })),
    venue: { active: venue.length, inGrace, monthlyCents: monthly },
  };
}
