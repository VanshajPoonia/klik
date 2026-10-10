import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { gt, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { entitlements } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { AdminNav } from "@/components/admin/admin-nav";
import { getPlan } from "@/lib/plans";
import { creditOwedTotals, formatCents } from "@/lib/referrals";
import { summarizeRevenue } from "@/lib/revenue";

export const metadata: Metadata = { title: "Revenue", robots: { index: false } };

const monthName = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * ADM-2: what Klik has taken, from what superadmins recorded when granting
 * (lib/revenue.ts). The hosted Stripe links never tell Klik about a payment,
 * so this is the ledger's account, and Stripe's Dashboard is the record of
 * money. Credit owed is here too, because it is money promised.
 */
export default async function AdminRevenuePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const [grants, owed] = await Promise.all([
    db
      .select({
        planKey: entitlements.planKey,
        scope: entitlements.scope,
        status: entitlements.status,
        amountCents: entitlements.amountCents,
        createdAt: entitlements.createdAt,
        endsAt: entitlements.endsAt,
        graceStartedAt: entitlements.graceStartedAt,
      })
      .from(entitlements)
      .where(gt(entitlements.createdAt, sql`now() - interval '13 months'`)),
    creditOwedTotals(),
  ]);
  const summary = summarizeRevenue(grants);
  const { thisMonth, venue } = summary;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin/revenue" />
        <p className="mb-6 max-w-2xl text-sm text-muted">
          From what was recorded as paid when each plan was granted. Stripe&apos;s Dashboard is the record of the money
          itself; grants from before amounts were kept show as not recorded.
        </p>
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs text-muted">Taken this month</p>
            <p className="mt-1 text-2xl font-semibold text-paper tabular-nums">{formatCents(thisMonth.paidCents)}</p>
            <p className="mt-1 text-xs text-muted">
              {thisMonth.paidCount} paid · {thisMonth.comps} comp · {thisMonth.notRecorded} not recorded
            </p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Venue, each month</p>
            <p className="mt-1 text-2xl font-semibold text-paper tabular-nums">{formatCents(venue.monthlyCents)}</p>
            <p className="mt-1 text-xs text-muted">
              {venue.active} running{venue.inGrace ? ` · ${venue.inGrace} with a failed payment` : ""}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Credit owed</p>
            <p className="mt-1 text-2xl font-semibold text-paper tabular-nums">{formatCents(owed.cents)}</p>
            <p className="mt-1 text-xs text-muted">Across {owed.accounts} accounts, from referrals</p>
          </Card>
        </div>

        {summary.byPlan.length > 0 && (
          <Card className="mb-8">
            <h2 className="text-sm font-medium text-paper">This month, by plan</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {summary.byPlan.map((plan) => (
                <li key={plan.planKey} className="flex justify-between gap-3">
                  <span className="text-paper">{getPlan(plan.planKey).name}</span>
                  <span className="tabular-nums text-muted">
                    {plan.paidCount} · {formatCents(plan.paidCents)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="text-sm font-medium text-paper">The last twelve months</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 font-medium">Month</th>
                <th className="py-1.5 text-right font-medium">Taken</th>
                <th className="py-1.5 text-right font-medium">Paid</th>
                <th className="py-1.5 text-right font-medium">Comp</th>
                <th className="py-1.5 text-right font-medium">Not recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-line">
              {[...summary.months].reverse().map((row) => (
                <tr key={row.month}>
                  <td className="py-1.5 text-paper">{monthName(row.month)}</td>
                  <td className="py-1.5 text-right tabular-nums text-paper">{formatCents(row.paidCents)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{row.paidCount}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{row.comps}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{row.notRecorded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
