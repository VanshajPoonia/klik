import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * ADM-7: a superadmin sees every event, moves one to another account with its
 * licence, makes a draft on someone's account, makes a login without an event,
 * and sets a password of their choosing.
 */

const session = { user: { id: "", role: "superadmin" as string, username: "boss", name: "Boss" } };
const afterTasks: Array<() => Promise<void>> = [];

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireSuperadmin: async () => (session.user.role === "superadmin" ? session : null),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true, id: "e1" }), isEmailConfigured: () => true }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const { POST: move } = await import("@/app/api/admin/events/[id]/owner/route");
const { POST: newEvent } = await import("@/app/api/admin/clients/[userId]/events/route");
const { POST: newClient } = await import("@/app/api/admin/clients/route");
const { POST: setPassword } = await import("@/app/api/admin/clients/[userId]/reset-password/route");
const { listAllEvents } = await import("@/lib/admin-events");
const { grantEntitlement } = await import("@/lib/entitlements");
const { verifyPassword } = await import("@/lib/credentials");
const { eventCoHosts, events, users } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  afterTasks.length = 0;
  await resetDatabase();
  session.user = { id: await makeUser({ role: "superadmin" }), role: "superadmin", username: "boss", name: "Boss" };
});
afterAll(closeDatabase);

const post = (url: string, body: unknown) =>
  new Request(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("ADM-7 moving an event", () => {
  it("moves it with its licence, keeps the old owner as a manager, and takes the new one off the team", async () => {
    const from = await makeUser();
    const to = await makeUser({ email: "new@example.test" });
    const eventId = await makeEvent(from, { name: "Ana & Bo" });
    await grantEntitlement({ userId: from, planKey: "premium", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
    await testDb.insert(eventCoHosts).values({ eventId, userId: to, role: "contributor" });
    const [before] = await testDb.select().from(events).where(eq(events.id, eventId));

    const response = await move(post(`/api/admin/events/${eventId}/owner`, { to: "NEW@example.test" }), { params: Promise.resolve({ id: eventId }) });
    expect(response.status).toBe(200);
    const [after] = await testDb.select().from(events).where(eq(events.id, eventId));
    expect(after.ownerId).toBe(to);
    expect(after.entitlementId).toBe(before.entitlementId);
    expect(after.planKey).toBe("premium");
    const team = await testDb.select().from(eventCoHosts).where(eq(eventCoHosts.eventId, eventId));
    expect(team.map((row) => [row.userId, row.role])).toEqual([[from, "manager"]]);
  });

  it("refuses an unknown account, the same owner, and anyone but a superadmin", async () => {
    const owner = await makeUser({ username: "owner1" });
    const eventId = await makeEvent(owner);
    const params = { params: Promise.resolve({ id: eventId }) };
    expect((await move(post(`/x`, { to: "nobody@example.test" }), params)).status).toBe(404);
    expect((await move(post(`/x`, { to: "@owner1" }), params)).status).toBe(409);
    session.user = { id: owner, role: "organizer", username: "owner1", name: "Owner" };
    expect((await move(post(`/x`, { to: "@owner1" }), params)).status).toBe(401);
  });
});

describe("ADM-7 making things for an account", () => {
  it("makes a draft on someone's account, in its look", async () => {
    const owner = await makeUser();
    const response = await newEvent(
      post(`/api/admin/clients/${owner}/events`, { name: "Ana & Bo", template: "white-lace", templateFields: { names: ["Ana", "Bo"] } }),
      { params: Promise.resolve({ userId: owner }) },
    );
    expect(response.status).toBe(201);
    const [row] = await testDb.select().from(events).where(eq(events.ownerId, owner));
    expect(row).toMatchObject({ name: "Ana & Bo", templateKey: "white-lace", entitlementId: null, licensedAt: null });
  });

  it("makes a login without an event, waiting for a plan, and refuses an email already used", async () => {
    const response = await newClient(post("/api/admin/clients", { contactName: "Grand Palace", email: "Hello@Palace.test", withEvent: false }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.event).toBeNull();
    const [account] = await testDb.select().from(users).where(eq(users.id, body.userId));
    expect(account).toMatchObject({ email: "hello@palace.test", activatedAt: null });
    expect(account.organizerIntentAt).not.toBeNull();
    expect(await testDb.select().from(events).where(eq(events.ownerId, body.userId))).toHaveLength(0);

    const again = await newClient(post("/api/admin/clients", { contactName: "Copy", email: "hello@palace.test", withEvent: false }));
    expect(again.status).toBe(409);
    const noName = await newClient(post("/api/admin/clients", { contactName: "No event name" }));
    expect(noName.status).toBe(400);
  });

  it("sets the password the superadmin typed, and refuses a short one", async () => {
    const owner = await makeUser({ username: "venue1", passwordHash: "x" });
    const params = { params: Promise.resolve({ userId: owner }) };
    expect((await setPassword(post("/x", { password: "short" }), params)).status).toBe(400);
    const response = await setPassword(post("/x", { password: "a chosen password 42" }), params);
    expect(response.status).toBe(200);
    const [account] = await testDb.select().from(users).where(and(eq(users.id, owner)));
    expect(await verifyPassword("a chosen password 42", account.passwordHash!)).toBe(true);
    const generated = await setPassword(new Request("https://example.test/x", { method: "POST" }), params);
    expect((await generated.json()).password).toMatch(/.{10,}/);
  });
});

describe("ADM-7 every event", () => {
  it("lists events across accounts, by state and by owner's email", async () => {
    const ana = await makeUser({ email: "ana@example.test" });
    const bo = await makeUser({ email: "bo@example.test" });
    const live = await makeEvent(ana, { name: "Wedding" });
    await grantEntitlement({ userId: ana, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: live });
    await makeEvent(bo, { name: "Birthday" });
    await makeEvent(bo, { name: "Old one", deletedAt: new Date() });

    expect((await listAllEvents("", "all")).map((row) => row.name).sort()).toEqual(["Birthday", "Old one", "Wedding"]);
    expect((await listAllEvents("", "live")).map((row) => row.name)).toEqual(["Wedding"]);
    expect((await listAllEvents("", "draft")).map((row) => row.name)).toEqual(["Birthday"]);
    expect((await listAllEvents("", "deleted")).map((row) => row.name)).toEqual(["Old one"]);
    expect((await listAllEvents("bo@example", "all")).map((row) => row.name).sort()).toEqual(["Birthday", "Old one"]);
  });
});
