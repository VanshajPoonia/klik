import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { subscriptionIdFromInvoice } from "./billing";
import { getPlanBilling } from "./stripe";
import { PLAN_KEYS, type PlanKey } from "./plans";

/**
 * Billing has one property worth more than the rest: a plan is charged the way
 * it is priced. Klik Venue is $69 every month and the other two are bought
 * once, so if Venue were ever sent as `payment` a venue would be billed a
 * single time and keep the plan forever, and if Event were sent as
 * `subscription` Stripe would reject a one-time Price outright. One of those
 * fails loudly and the other does not, which is why it is pinned here.
 */
const EXPECTED_MODE: Record<PlanKey, "payment" | "subscription"> = {
  event: "payment",
  premium: "payment",
  venue: "subscription",
};

describe("getPlanBilling", () => {
  it.each(PLAN_KEYS)("charges %s the way it is priced", (planKey) => {
    expect(getPlanBilling(planKey).mode).toBe(EXPECTED_MODE[planKey]);
  });

  /**
   * Adding a plan to PLAN_KEYS without deciding how it is charged should fail
   * here rather than at someone's checkout.
   */
  it("covers every plan the app knows about", () => {
    expect(Object.keys(EXPECTED_MODE).sort()).toEqual([...PLAN_KEYS].sort());
  });

  it("reports no price when the environment has none, so the route can answer 503", () => {
    // The test environment sets no STRIPE_PRICE_* values. A missing price must
    // surface as undefined, never as an empty string that Stripe would reject
    // with something less obvious.
    expect(getPlanBilling("event").priceId).toBeUndefined();
  });
});

/**
 * Where an invoice carries its subscription id moved between API versions: it
 * used to sit at the top level and newer shapes only expose it on the line
 * items. Reading one shape and not the other means subscription invoices
 * silently stop updating anything, with no error to notice.
 */
describe("subscriptionIdFromInvoice", () => {
  const invoice = (shape: unknown) => shape as Stripe.Invoice;

  it("reads a top-level string", () => {
    expect(subscriptionIdFromInvoice(invoice({ subscription: "sub_123" }))).toBe("sub_123");
  });

  it("reads a top-level expanded object", () => {
    expect(subscriptionIdFromInvoice(invoice({ subscription: { id: "sub_456" } }))).toBe("sub_456");
  });

  it("falls back to the line items", () => {
    expect(
      subscriptionIdFromInvoice(
        invoice({
          lines: {
            data: [{ parent: { subscription_item_details: { subscription: "sub_789" } } }],
          },
        }),
      ),
    ).toBe("sub_789");
  });

  it("reads an expanded subscription on a line item", () => {
    expect(
      subscriptionIdFromInvoice(
        invoice({
          lines: {
            data: [{ parent: { subscription_item_details: { subscription: { id: "sub_abc" } } } }],
          },
        }),
      ),
    ).toBe("sub_abc");
  });

  it("returns null for a one-off invoice with no subscription anywhere", () => {
    expect(subscriptionIdFromInvoice(invoice({ lines: { data: [{}] } }))).toBeNull();
    expect(subscriptionIdFromInvoice(invoice({}))).toBeNull();
  });
});
