import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * GRW-5: a referral is recorded once, pays both sides once at the first grant,
 * and credit is only ever spent by a superadmin, never past the balance.
 */

const admin = { user: { id: "", role: "superadmin", username: "boss", name: "Boss" } };
const afterTasks: Array<() => Promise<void>> = [];
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
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const { GET: referralLink } = await import("@/app/r/[code]/route");
const { POST: signup } = await import("@/app/api/signup/route");
const { POST: grant } = await import("@/app/api/admin/clients/[userId]/entitlements/route");
const { POST: spend } = await import("@/app/api/admin/clients/[userId]/credits/route");
const { attachReferral, creditBalance, referralSummary, REFERRAL_CREDIT_CENTS } = await import("@/lib/referrals");
const { accountCredits, referrals, users } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  afterTasks.length = 0;
  sendEmail.mockClear();
  await resetDatabase();
  admin.user.id = await makeUser({ role: "superadmin" });
});
afterAll(closeDatabase);

async function codeOf(userId: string) {
  const [row] = await testDb.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
  return row.code;
}

function post(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const grantTo = (userId: string) =>
  grant(post(`/api/admin/clients/${userId}/entitlements`, { planKey: "event", reason: "Paid by card" }), { params: Promise.resolve({ userId }) });

describe("GRW-5 codes and links", () => {
  it("gives every account its own code, made by the database", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const [codeA, codeB] = [await codeOf(a), await codeOf(b)];
    expect(codeA).toMatch(/^[0-9a-f]{10}$/);
    expect(codeA).not.toBe(codeB);
  });

  it("remembers a real code for 30 days and ignores a made-up one, landing on the home page either way", async () => {
    const code = await codeOf(await makeUser());
    const real = await referralLink(new Request(`https://example.test/r/${code}`), { params: Promise.resolve({ code }) });
    expect(real.headers.get("location")).toBe("https://example.test/");
    expect(real.headers.get("set-cookie")).toMatch(new RegExp(`klik_ref=${code}.*Max-Age=2592000`, "i"));

    const fake = await referralLink(new Request("https://example.test/r/0000000000"), { params: Promise.resolve({ code: "0000000000" }) });
    expect(fake.headers.get("location")).toBe("https://example.test/");
    expect(fake.headers.get("set-cookie")).toBeNull();
  });
});

describe("GRW-5 attaching", () => {
  it("records a referral once, never to yourself, and never for an existing customer", async () => {
    const referrer = await makeUser();
    const code = await codeOf(referrer);
    expect(await attachReferral(referrer, code)).toBe(false);

    const friend = await makeUser();
    expect(await attachReferral(friend, code)).toBe(true);
    expect(await attachReferral(friend, await codeOf(await makeUser()))).toBe(false);

    const customer = await makeUser();
    await grantTo(customer);
    expect(await attachReferral(customer, code)).toBe(false);
    expect(await testDb.select().from(referrals)).toHaveLength(1);
  });
});

describe("GRW-5 signing up through a link", () => {
  it("records who sent the new account", async () => {
    const referrer = await makeUser();
    const response = await signup(
      new Request("https://example.test/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `other=1; klik_ref=${await codeOf(referrer)}`, "x-forwarded-for": "203.0.113.77" },
        body: JSON.stringify({ name: "Cy", email: "cy@example.test", password: "a long enough password 1" }),
      }),
    );
    expect(response.status).toBeLessThan(300);
    const [created] = await testDb.select({ id: users.id }).from(users).where(eq(users.email, "cy@example.test"));
    const [row] = await testDb.select().from(referrals).where(eq(referrals.referredId, created.id));
    expect(row.referrerId).toBe(referrer);
  });
});

describe("GRW-5 paying out", () => {
  it("credits both sides at the first grant, once, and tells the referrer", async () => {
    const referrer = await makeUser({ name: "Ana", email: "ana@example.test" });
    const friend = await makeUser({ name: "Bo" });
    await attachReferral(friend, await codeOf(referrer));

    expect((await grantTo(friend)).status).toBe(201);
    expect((await grantTo(friend)).status).toBe(201);
    expect(await creditBalance(referrer)).toBe(REFERRAL_CREDIT_CENTS);
    expect(await creditBalance(friend)).toBe(REFERRAL_CREDIT_CENTS);

    for (const task of afterTasks) await task();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@example.test", subject: "You earned $10 of Klik credit" }));

    const summary = await referralSummary(referrer);
    expect(summary).toMatchObject({ joined: 1, qualified: 1, balanceCents: REFERRAL_CREDIT_CENTS });
    expect(summary.history[0].reason).toBe("Referral: Bo started using Klik.");
  });

  it("pays nothing for an account nobody referred", async () => {
    const loner = await makeUser();
    await grantTo(loner);
    expect(await testDb.select().from(accountCredits)).toHaveLength(0);
  });
});

describe("GRW-5 spending", () => {
  it("is a superadmin's record, with a reason, never past the balance", async () => {
    const referrer = await makeUser();
    const friend = await makeUser();
    await attachReferral(friend, await codeOf(referrer));
    await grantTo(friend);
    const use = (amountCents: number, reason = "Refunded in Stripe") =>
      spend(post(`/api/admin/clients/${friend}/credits`, { amountCents, reason }), { params: Promise.resolve({ userId: friend }) });

    expect((await use(REFERRAL_CREDIT_CENTS + 1)).status).toBe(400);
    expect((await use(400, "x")).status).toBe(400);
    const spent = await use(400);
    expect(await spent.json()).toEqual({ balanceCents: REFERRAL_CREDIT_CENTS - 400 });
    expect(await creditBalance(friend)).toBe(REFERRAL_CREDIT_CENTS - 400);
  });
});
