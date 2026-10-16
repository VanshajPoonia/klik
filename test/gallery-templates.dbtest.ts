import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * A template picked on the create form lands in the event's own colours, and
 * any plan may switch between templates later, while colours of one's own stay
 * Premium's.
 */

const session = { user: null as { id: string; role?: string } | null };
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireEventCapability: async () => (session.user ? { session: { user: session.user }, role: "owner" } : null),
}));

const { grantEntitlement } = await import("@/lib/entitlements");
const { POST: createEvent } = await import("@/app/api/events/route");
const { PATCH: saveEvent } = await import("@/app/api/events/[id]/route");
const { events } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session.user = null;
  await resetDatabase();
});
afterAll(closeDatabase);

function request(method: string, url: string, body: unknown) {
  return new Request(`https://example.test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function colorsOf(id: string) {
  const [row] = await testDb
    .select({ accent: events.accentColor, background: events.backgroundColor })
    .from(events)
    .where(eq(events.id, id));
  return row;
}

async function liveEvent(planKey: "event" | "premium") {
  const ownerId = await makeUser();
  session.user = { id: ownerId };
  const id = await makeEvent(ownerId);
  await grantEntitlement({ userId: ownerId, planKey, source: "admin", reason: "Test", grantedBy: null, applyToEventId: id });
  return id;
}

describe("templates on the create form", () => {
  it("writes the chosen template's colours to the new event", async () => {
    session.user = { id: await makeUser() };
    const response = await createEvent(request("POST", "/api/events", { name: "Maya's 30th", template: "confetti" }));
    expect(response.status).toBe(201);
    const { event } = await response.json();
    expect(await colorsOf(event.id)).toEqual({ accent: "#ff4f8b", background: "#1c0f22" });
  });

  it("leaves Plain, or no choice at all, on the column defaults", async () => {
    session.user = { id: await makeUser() };
    for (const body of [{ name: "One", template: "plain" }, { name: "Two" }]) {
      const { event } = await (await createEvent(request("POST", "/api/events", body))).json();
      expect(await colorsOf(event.id)).toEqual({ accent: "#e8f000", background: "#090a08" });
    }
  });

  it("refuses a template that does not exist", async () => {
    session.user = { id: await makeUser() };
    const response = await createEvent(request("POST", "/api/events", { name: "Three", template: "neon-dreams" }));
    expect(response.status).toBe(400);
  });
});

describe("templates in Settings", () => {
  it("lets the $39 plan switch to another template", async () => {
    const id = await liveEvent("event");
    const response = await saveEvent(
      request("PATCH", `/api/events/${id}`, { accentColor: "#F2C14E", backgroundColor: "#0C1626" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(200);
    expect((await colorsOf(id)).accent.toLowerCase()).toBe("#f2c14e");
  });

  it("keeps colours of one's own, and half a template, to Premium", async () => {
    const id = await liveEvent("event");
    for (const body of [
      { accentColor: "#123456", backgroundColor: "#abcdef" },
      { accentColor: "#f2c14e" },
      { accentColor: "#f2c14e", backgroundColor: "#0c1626", coverMediaId: null },
    ]) {
      const response = await saveEvent(request("PATCH", `/api/events/${id}`, body), { params: Promise.resolve({ id }) });
      expect(response.status, JSON.stringify(body)).toBe(403);
    }
    expect(await colorsOf(id)).toEqual({ accent: "#e8f000", background: "#090a08" });
  });

  it("still lets Premium choose anything", async () => {
    const id = await liveEvent("premium");
    const response = await saveEvent(
      request("PATCH", `/api/events/${id}`, { accentColor: "#123456", backgroundColor: "#abcdef" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(200);
    expect(await colorsOf(id)).toEqual({ accent: "#123456", background: "#abcdef" });
  });
});
