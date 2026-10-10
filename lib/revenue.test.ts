import { describe, expect, it } from "vitest";
import { summarizeRevenue, type RevenueGrant } from "./revenue";
import { PLANS } from "./plans";

const grant = (overrides: Partial<RevenueGrant>): RevenueGrant => ({
  planKey: "event",
  scope: "event",
  status: "active",
  amountCents: 3900,
  createdAt: new Date("2026-10-05T12:00:00Z"),
  endsAt: null,
  graceStartedAt: null,
  ...overrides,
});

describe("ADM-2 revenue from the ledger", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("adds this month's recorded payments, and keeps comps and unrecorded grants apart", () => {
    const summary = summarizeRevenue(
      [
        grant({}),
        grant({ planKey: "premium", amountCents: 8900 }),
        grant({ amountCents: 0 }),
        grant({ amountCents: null }),
        grant({ createdAt: new Date("2026-09-30T23:00:00Z") }),
      ],
      now,
    );
    expect(summary.thisMonth).toEqual({ month: "2026-10", paidCents: 12800, paidCount: 2, comps: 1, notRecorded: 1 });
    expect(summary.months).toHaveLength(12);
    expect(summary.months[10]).toMatchObject({ month: "2026-09", paidCents: 3900 });
    expect(summary.byPlan).toEqual(
      expect.arrayContaining([
        { planKey: "event", paidCents: 3900, paidCount: 1 },
        { planKey: "premium", paidCents: 8900, paidCount: 1 },
      ]),
    );
  });

  it("counts running Venue plans as what recurs, at what was paid or the list price", () => {
    const summary = summarizeRevenue(
      [
        grant({ planKey: "venue", scope: "account", amountCents: 6000 }),
        grant({ planKey: "venue", scope: "account", amountCents: null, graceStartedAt: now, endsAt: new Date("2026-10-27T00:00:00Z") }),
        grant({ planKey: "venue", scope: "account", status: "revoked" }),
        grant({ planKey: "venue", scope: "account", endsAt: new Date("2026-10-01T00:00:00Z") }),
      ],
      now,
    );
    expect(summary.venue).toEqual({ active: 2, inGrace: 1, monthlyCents: 6000 + PLANS.venue.priceCents });
  });
});

describe("plan prices", () => {
  it("records the same price the pricing page shows", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.priceCents, plan.key).toBe(Math.round(Number(plan.price.replace(/[^0-9.]/g, "")) * 100));
    }
  });
});
