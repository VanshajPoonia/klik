import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * ADM-6: a plan button that reaches /signup is recorded against the account,
 * once per click rather than once per reload, and /admin reads the newest.
 */

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: false, reason: "not_configured" }), isEmailConfigured: () => false }));

const { POST: signup } = await import("@/app/api/signup/route");
const { latestPlanRequests, recordPlanRequest, describePlanRequest } = await import("@/lib/plan-requests");
const { getPendingSignups } = await import("@/lib/billing-admin");
const { accountTimeline, planRequests, users } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

function signupRequest(body: unknown, ip: string) {
  return new Request("https://example.test/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("ADM-6 plan requests", () => {
  it("records the plan, the kind of event and the date chosen at signup", async () => {
    const response = await signup(
      signupRequest(
        { name: "Ana", email: "ana@example.test", password: "a long enough password 1", planKey: "premium", occasion: "wedding", eventDate: "2026-06-13" },
        "203.0.113.10",
      ),
    );
    expect(response.status).toBe(201);
    const [account] = await testDb.select({ id: users.id }).from(users).where(eq(users.email, "ana@example.test"));
    const rows = await testDb.select().from(planRequests).where(eq(planRequests.userId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ planKey: "premium", occasion: "wedding", eventDate: "2026-06-13", source: "signup" });
    const history = await testDb.select().from(accountTimeline).where(eq(accountTimeline.userId, account.id));
    expect(history.map((entry) => entry.detail)).toContain("Asked for Klik Premium, for a wedding on 13 Jun 2026 when signing up.");

    const [pending] = await getPendingSignups();
    expect(pending.request?.summary).toBe("Klik Premium, for a wedding on 13 Jun 2026");
  });

  it("never refuses a signup over a plan it cannot read", async () => {
    const response = await signup(
      signupRequest({ name: "Bo", email: "bo@example.test", password: "a long enough password 1", planKey: "gold", eventDate: "soon" }, "203.0.113.11"),
    );
    expect(response.status).toBe(201);
    expect(await testDb.select().from(planRequests)).toHaveLength(0);
  });

  it("counts a reload as the same click, a different plan as a new one, and reads the newest", async () => {
    const userId = await makeUser();
    await recordPlanRequest({ userId, planKey: "event", source: "signed_in" });
    await recordPlanRequest({ userId, planKey: "event", source: "signed_in" });
    expect(await testDb.select().from(planRequests)).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordPlanRequest({ userId, planKey: "venue", occasion: "company", source: "signed_in" });
    expect(await testDb.select().from(planRequests)).toHaveLength(2);
    expect((await latestPlanRequests([userId])).get(userId)?.summary).toBe("Klik Venue, for a company party");
  });

  it("says something sensible with only some of it", () => {
    expect(describePlanRequest({ planKey: "event" })).toBe("Klik Event");
    expect(describePlanRequest({ planKey: "event", occasion: "other", eventDate: "2026-01-02" })).toBe("Klik Event, for an event on 2 Jan 2026");
  });
});
