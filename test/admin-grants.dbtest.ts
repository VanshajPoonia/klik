import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The superadmin's grant controls, driven through their real routes the way
 * the /admin page drives them: a pass for a new signup, a pass for a draft
 * that asked to go live, an upgrade, Venue, and taking one back.
 */

const admin = { user: { id: "", role: "superadmin", username: "boss", name: "Boss" } };

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => admin }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireSuperadmin: async () => admin,
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true, id: "e1" }), isEmailConfigured: () => true }));
vi.mock("@/lib/activation-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/activation-notice")>()),
  sendActivationNotice: async () => ({ sent: false, reason: "not_configured" }),
  sendEventLiveNotice: async () => ({ sent: false, reason: "not_configured" }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const { POST: grant } = await import("@/app/api/admin/clients/[userId]/entitlements/route");
const { POST: revoke } = await import("@/app/api/admin/entitlements/[entitlementId]/revoke/route");
const { PATCH: editClient } = await import("@/app/api/admin/clients/[userId]/route");
const { eventLicenseState } = await import("@/lib/license");
const { accountTimeline, events, users } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  await resetDatabase();
  admin.user.id = await makeUser({ role: "superadmin" });
});
afterAll(closeDatabase);

function post(url: string, body: unknown, method = "POST") {
  return new Request(`https://example.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function grantTo(userId: string, body: Record<string, unknown>) {
  const response = await grant(post(`/api/admin/clients/${userId}/entitlements`, { reason: "Paid by card", ...body }), {
    params: Promise.resolve({ userId }),
  });
  return { status: response.status, body: await response.json() };
}

async function stateOf(eventId: string) {
  const [row] = await testDb.select().from(events).where(eq(events.id, eventId));
  return { state: eventLicenseState(row), planKey: row.planKey };
}

describe("granting from /admin", () => {
  it("gives a new signup with no event an unused pass, and activates the account", async () => {
    const userId = await makeUser({ activatedAt: null, organizerIntentAt: new Date() });
    const { status, body } = await grantTo(userId, { planKey: "event", amountCents: 3900 });
    expect(status).toBe(201);
    expect(body.licensed).toEqual([]);
    const [account] = await testDb.select().from(users).where(eq(users.id, userId));
    expect(account.activatedAt).not.toBeNull();
  });

  it("puts their waiting draft live when no event is picked", async () => {
    const userId = await makeUser({ activatedAt: null });
    const draft = await makeEvent(userId, { activationRequestedAt: new Date() });
    const { status, body } = await grantTo(userId, { planKey: "premium" });
    expect(status).toBe(201);
    expect(body.licensed).toEqual([draft]);
    expect(await stateOf(draft)).toEqual({ state: "live", planKey: "premium" });
  });

  it("puts the picked event live, not the oldest draft", async () => {
    const userId = await makeUser();
    const older = await makeEvent(userId, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const picked = await makeEvent(userId);
    await grantTo(userId, { planKey: "event", eventId: picked });
    expect((await stateOf(picked)).state).toBe("live");
    expect((await stateOf(older)).state).toBe("draft");
  });

  it("upgrades a live event to Premium", async () => {
    const userId = await makeUser();
    const id = await makeEvent(userId);
    await grantTo(userId, { planKey: "event", eventId: id });
    const { body } = await grantTo(userId, { planKey: "premium", eventId: id });
    expect(body.refused).toEqual([]);
    expect(await stateOf(id)).toEqual({ state: "live", planKey: "premium" });
  });

  it("puts every waiting draft live with Venue", async () => {
    const userId = await makeUser();
    const drafts = [await makeEvent(userId), await makeEvent(userId)];
    const { body } = await grantTo(userId, { planKey: "venue" });
    expect([...body.licensed].sort()).toEqual([...drafts].sort());
  });

  it("takes a pass back, and its event stops taking uploads", async () => {
    const userId = await makeUser();
    const id = await makeEvent(userId);
    const { body } = await grantTo(userId, { planKey: "event", eventId: id });
    const response = await revoke(
      post(`/api/admin/entitlements/${body.entitlement.id}/revoke`, { reason: "Refunded" }),
      { params: Promise.resolve({ entitlementId: body.entitlement.id }) },
    );
    expect(response.status).toBe(200);
    expect((await stateOf(id)).state).toBe("lapsed");
  });

  it("can put an event live that a superadmin owns", async () => {
    const id = await makeEvent(admin.user.id, { activationRequestedAt: new Date() });
    const { status } = await grantTo(admin.user.id, { planKey: "premium", eventId: id });
    expect(status).toBe(201);
    expect((await stateOf(id)).state).toBe("live");
  });
});

describe("editing an account", () => {
  const edit = (userId: string, body: unknown) =>
    editClient(post(`/api/admin/clients/${userId}`, body, "PATCH"), { params: Promise.resolve({ userId }) });

  it("changes name, email and handle, and writes what they were to the history", async () => {
    const userId = await makeUser({ name: "Dave", email: "dave@old.test", username: "dave_old", usernameChangedAt: new Date() });
    const response = await edit(userId, { name: "Dave Smith", email: "Dave@New.test", username: "davesmith" });
    expect(response.status).toBe(200);
    const [row] = await testDb.select().from(users).where(eq(users.id, userId));
    expect(row).toMatchObject({ name: "Dave Smith", email: "dave@new.test", username: "davesmith" });
    const [entry] = await testDb.select().from(accountTimeline).where(eq(accountTimeline.userId, userId));
    expect(entry.kind).toBe("details_changed");
    expect(entry.detail).toContain("dave@old.test");
  });

  it("refuses an email another account has", async () => {
    await makeUser({ email: "taken@x.test" });
    const userId = await makeUser();
    expect((await edit(userId, { email: "taken@x.test" })).status).toBe(409);
  });
});

