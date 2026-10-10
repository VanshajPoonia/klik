import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * GRW-4: what a public profile lists, and who may put an event on it. The
 * rule that matters: nothing reaches the page that its owner did not choose,
 * and nothing that a stranger could not already open.
 */

const session = { user: null as { id: string; role?: string } | null };
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireEventCapability: async () => (session.user ? { session: { user: session.user }, role: "owner" } : null),
}));

const { profileFor } = await import("@/lib/profiles");
const { grantEntitlement } = await import("@/lib/entitlements");
const { PATCH: saveProfile } = await import("@/app/api/me/profile/route");
const { PATCH: saveEvent } = await import("@/app/api/events/[id]/route");
const { events, users } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session.user = null;
  await resetDatabase();
});
afterAll(closeDatabase);


async function photographer() {
  const id = await makeUser({ name: "Jo Lens", username: "jolens", profilePublic: true, profileBio: "Weddings in Austin." });
  return id;
}

/** A listed event, licensed by its own pass the way the app licenses one, unless it is to stay a draft. */
async function listedEvent(ownerId: string, overrides: Partial<typeof events.$inferInsert> & { draft?: boolean } = {}) {
  const { draft, ...columns } = overrides;
  const id = await makeEvent(ownerId, { showOnProfile: true, ...columns });
  if (!draft) {
    await grantEntitlement({ userId: ownerId, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: id });
  }
  return id;
}

function patch(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("GRW-4 what a profile lists", () => {
  it("lists only live, open, non-private events its owner chose, newest first", async () => {
    const owner = await photographer();
    await listedEvent(owner, { name: "Ana and Bo", eventDate: new Date("2026-06-01T00:00:00Z") });
    await listedEvent(owner, { name: "Spring gala", eventDate: new Date("2026-09-01T00:00:00Z"), visibility: "password", passwordHash: "x" });
    await listedEvent(owner, { name: "Not chosen", showOnProfile: false });
    await listedEvent(owner, { name: "Private", visibility: "private" });
    await listedEvent(owner, { name: "Draft", draft: true });
    await listedEvent(owner, { name: "Deleted", deletedAt: new Date() });
    await listedEvent(owner, { name: "Closed", isActive: false });
    await listedEvent(owner, { name: "Expired", expiresAt: new Date("2020-01-01T00:00:00Z") });
    await listedEvent(owner, { name: "Purged", purgedAt: new Date() });
    await listedEvent(await makeUser(), { name: "Someone else's" });

    const profile = await profileFor("JoLens");
    expect(profile?.kind).toBe("profile");
    if (profile?.kind !== "profile") return;
    expect(profile.events.map((event) => [event.name, event.needsPassword])).toEqual([
      ["Spring gala", true],
      ["Ana and Bo", false],
    ]);
    expect(profile.bio).toBe("Weddings in Austin.");
  });

  it("does not exist until its owner makes it public", async () => {
    await makeUser({ username: "quietone", profilePublic: false });
    expect(await profileFor("quietone")).toBeNull();
    expect(await profileFor("nobody_here")).toBeNull();
    expect(await profileFor("../etc")).toBeNull();
  });

  it("follows a handle changed in the last 30 days, and only to a public profile", async () => {
    const id = await photographer();
    await testDb.update(users).set({ username: "jolensphoto" }).where(eq(users.id, id));
    expect(await profileFor("jolens")).toEqual({ kind: "moved", username: "jolensphoto" });
    await testDb.update(users).set({ profilePublic: false }).where(eq(users.id, id));
    expect(await profileFor("jolens")).toBeNull();
  });
});

describe("GRW-4 saving", () => {
  it("needs a username to go public, and keeps the website to https", async () => {
    const id = await makeUser({ username: null });
    session.user = { id };
    expect((await saveProfile(patch("/api/me/profile", { isPublic: true }))).status).toBe(400);

    await testDb.update(users).set({ username: "jo_lens" }).where(eq(users.id, id));
    expect((await saveProfile(patch("/api/me/profile", { isPublic: true, website: "http://x.com" }))).status).toBe(400);
    const saved = await saveProfile(patch("/api/me/profile", { isPublic: true, bio: "  Hi  ", website: "jolens.com" }));
    expect(await saved.json()).toMatchObject({ profile: { isPublic: true, bio: "Hi", website: "https://jolens.com/" } });
  });

  it("lets only the owner list an event, and never a private one", async () => {
    const owner = await photographer();
    const eventId = await makeEvent(owner, { visibility: "public" });
    const params = { params: Promise.resolve({ id: eventId }) };

    session.user = { id: await makeUser() };
    expect((await saveEvent(patch(`/api/events/${eventId}`, { showOnProfile: true }), params)).status).toBe(403);

    session.user = { id: owner };
    expect((await saveEvent(patch(`/api/events/${eventId}`, { showOnProfile: true, visibility: "private" }), params)).status).toBe(400);
    expect((await saveEvent(patch(`/api/events/${eventId}`, { showOnProfile: true }), params)).status).toBe(200);
    const [row] = await testDb.select({ showOnProfile: events.showOnProfile }).from(events).where(eq(events.id, eventId));
    expect(row.showOnProfile).toBe(true);
  });
});
