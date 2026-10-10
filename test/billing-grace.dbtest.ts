import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * PAY-5, PAY-8, ADM-2: grants record what was paid, a failed Venue payment
 * gets 7 working days with three emails, and recording the payment ends it.
 */

const admin = { user: { id: "", role: "superadmin", username: "boss", name: "Boss" } };
const sendEmail = vi.fn(async () => ({ sent: true as const, id: "e1" }));

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => admin }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireSuperadmin: async () => admin,
}));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));
vi.mock("@/lib/activation-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activation-notice")>()),
  sendActivationNotice: async () => ({ sent: false, reason: "not_configured" }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const { POST: grant } = await import("@/app/api/admin/clients/[userId]/entitlements/route");
const { POST: grace } = await import("@/app/api/admin/entitlements/[id]/grace/route");
const { sendGraceNotice, graceMessage } = await import("@/lib/billing-grace");
const { creditOwedTotals } = await import("@/lib/referrals");
const { accountCredits, entitlements, jobs } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  sendEmail.mockClear();
  await resetDatabase();
  admin.user.id = await makeUser({ role: "superadmin" });
});
afterAll(closeDatabase);

function post(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function grantTo(userId: string, body: Record<string, unknown>) {
  const response = await grant(post(`/api/admin/clients/${userId}/entitlements`, { reason: "Paid by card", ...body }), {
    params: Promise.resolve({ userId }),
  });
  return (await response.json()).entitlement as { id: string; amountCents: number | null; stripeRef: string | null };
}

const graceAction = (id: string, action: "start" | "clear") =>
  grace(post(`/api/admin/entitlements/${id}/grace`, { action }), { params: Promise.resolve({ id }) });

describe("PAY-5 a grant records what was paid", () => {
  it("keeps the amount and Stripe's reference, and 0 for a comp", async () => {
    const paid = await grantTo(await makeUser(), { planKey: "premium", amountCents: 8900, stripeRef: "pi_123" });
    expect(paid).toMatchObject({ amountCents: 8900, stripeRef: "pi_123" });
    const comp = await grantTo(await makeUser(), { planKey: "event", amountCents: 0 });
    expect(comp.amountCents).toBe(0);
  });
});

describe("PAY-8 a failed Venue payment", () => {
  it("keeps everything working for 7 days, queues three emails, and ends when payment is recorded", async () => {
    const organizer = await makeUser({ email: "venue@example.test", name: "Vee" });
    const venue = await grantTo(organizer, { planKey: "venue", amountCents: 6900 });

    expect((await graceAction(venue.id, "start")).status).toBe(200);
    const [row] = await testDb.select().from(entitlements).where(eq(entitlements.id, venue.id));
    expect(row.graceStartedAt).not.toBeNull();
    const days = (row.endsAt!.getTime() - row.graceStartedAt!.getTime()) / 86_400_000;
    expect(days).toBe(7);

    const queued = await testDb.select().from(jobs).where(eq(jobs.kind, "notify.grace"));
    expect(queued.map((job) => (job.payload as { day: number }).day).sort()).toEqual([0, 3, 6]);

    // A second start is refused: one grace at a time.
    expect((await graceAction(venue.id, "start")).status).toBe(409);

    const payload = { entitlementId: venue.id, startedAt: row.graceStartedAt!.toISOString(), day: 0 as const };
    await sendGraceNotice(payload);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "venue@example.test", subject: "Your Klik Venue payment did not go through" }));

    expect((await graceAction(venue.id, "clear")).status).toBe(200);
    const [cleared] = await testDb.select().from(entitlements).where(eq(entitlements.id, venue.id));
    expect(cleared).toMatchObject({ graceStartedAt: null, endsAt: null });

    // The reminders still queued for the old grace stay quiet.
    sendEmail.mockClear();
    await sendGraceNotice({ ...payload, day: 3 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("is only for a running Venue plan, not for a pass", async () => {
    const pass = await grantTo(await makeUser(), { planKey: "event", amountCents: 3900 });
    expect((await graceAction(pass.id, "start")).status).toBe(409);
    expect((await graceAction(pass.id, "clear")).status).toBe(409);
  });

  it("says what to do, with the card button only when Stripe's portal is set up", () => {
    const endsAt = new Date("2026-10-17T12:00:00Z");
    const self = graceMessage({ day: 6, name: "Vee", planName: "Klik Venue", endsAt, fixUrl: "https://billing.stripe.com/p/login/x", canSelfServe: true });
    expect(self.subject).toBe("Klik Venue pauses tomorrow");
    expect(self.text).toContain("Update your card");
    expect(self.text).toContain("nothing is deleted");
    const byHand = graceMessage({ day: 0, name: null, planName: "Klik Venue", endsAt, fixUrl: "https://example.test/dashboard/billing", canSelfServe: false });
    expect(byHand.text).toContain("Reply to this email or call us");
  });
});

describe("ADM-2 credit owed", () => {
  it("adds every positive balance and ignores spent ones", async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    await testDb.insert(accountCredits).values([
      { id: "c1", userId: a, amountCents: 1000, reason: "Referral" },
      { id: "c2", userId: b, amountCents: 1000, reason: "Referral" },
      { id: "c3", userId: b, amountCents: -400, reason: "Refunded" },
      { id: "c4", userId: c, amountCents: 1000, reason: "Referral" },
      { id: "c5", userId: c, amountCents: -1000, reason: "Refunded" },
    ]);
    expect(await creditOwedTotals()).toEqual({ cents: 1600, accounts: 2 });
  });
});
