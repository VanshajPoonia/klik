import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { eq, sql } from "drizzle-orm";

let session: Session | null = null;

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

const { changeUsername, searchUsers, usernameAvailability } = await import("@/lib/account");
const { PATCH: patchMe } = await import("@/app/api/me/route");
const { POST: changePassword } = await import("@/app/api/me/password/route");
const { GET: search } = await import("@/app/api/users/search/route");
const { hashPassword, verifyPassword } = await import("@/lib/credentials");
const { users } = await import("@/lib/schema");
const { closeDatabase, daysFromNow, makeUser, resetDatabase, testDb } = await import("./harness");

const signedInAs = (id: string) => {
  session = { user: { id, role: "organizer" }, expires: daysFromNow(30).toISOString() } as unknown as Session;
};
const json = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Moves a change into the past, as 30 days passing would. */
const age = (userId: string, days: number) =>
  testDb
    .update(users)
    .set({ usernameChangedAt: sql`now() - (${days}::int * interval '1 day')` })
    .where(eq(users.id, userId));

beforeEach(async () => {
  session = null;
  await resetDatabase();
});

afterAll(closeDatabase);

describe("ID-1 uniqueness", () => {
  it("refuses a second account whose handle differs only in case", async () => {
    await makeUser({ username: "Anita" });
    await expect(makeUser({ username: "anita" })).rejects.toThrow();
  });
});

describe("changeUsername", () => {
  it("parks the old handle, so nobody else can take it for 30 days", async () => {
    const anita = await makeUser({ username: "anita_old" });
    const stranger = await makeUser({ username: "stranger" });

    expect(await changeUsername(anita, "anita")).toEqual({ ok: true, username: "anita" });
    const taken = await changeUsername(stranger, "anita_old");
    expect(taken).toMatchObject({ ok: false, status: 409 });
    expect((await usernameAvailability("anita_old", stranger)).available).toBe(false);
  });

  it("lets the person who parked a handle take it back", async () => {
    const anita = await makeUser({ username: "anita_old" });
    await changeUsername(anita, "anita");
    await age(anita, 31);
    expect(await changeUsername(anita, "anita_old")).toEqual({ ok: true, username: "anita_old" });
    // And taking it back parks the one just left.
    expect((await usernameAvailability("anita", await makeUser())).available).toBe(false);
  });

  it("releases a parked handle once its 30 days are up", async () => {
    const anita = await makeUser({ username: "anita_old" });
    await changeUsername(anita, "anita");
    await testDb.execute(sql`UPDATE username_reservations SET released_at = now() - interval '1 minute'`);
    const stranger = await makeUser();
    expect(await changeUsername(stranger, "anita_old")).toEqual({ ok: true, username: "anita_old" });
  });

  it("allows one change per 30 days", async () => {
    const anita = await makeUser({ username: "anita_one" });
    expect((await changeUsername(anita, "anita_two")).ok).toBe(true);
    const again = await changeUsername(anita, "anita_three");
    expect(again).toMatchObject({ ok: false, status: 429 });
    await age(anita, 30);
    expect((await changeUsername(anita, "anita_three")).ok).toBe(true);
  });

  it("refuses a handle that is in use under different casing", async () => {
    await makeUser({ username: "Taken" });
    const anita = await makeUser();
    expect(await changeUsername(anita, "taken")).toMatchObject({ ok: false, status: 409 });
  });

  it("does not count saving the same handle as a change", async () => {
    const anita = await makeUser({ username: "anita" });
    expect(await changeUsername(anita, "@Anita")).toEqual({ ok: true, username: "anita" });
    const [row] = await testDb.select().from(users).where(eq(users.id, anita));
    expect(row.usernameChangedAt).toBeNull();
  });

  it("enforces parking even for a write that skips lib/account.ts", async () => {
    const anita = await makeUser({ username: "anita_old" });
    await changeUsername(anita, "anita");
    const other = await makeUser();
    await expect(testDb.update(users).set({ username: "anita_old" }).where(eq(users.id, other))).rejects.toThrow();
  });
});

describe("usernameAvailability", () => {
  it("says why, and calls your own handle yours", async () => {
    const anita = await makeUser({ username: "anita" });
    expect(await usernameAvailability("an", null)).toMatchObject({ available: false });
    expect(await usernameAvailability("admin", null)).toMatchObject({ available: false, reason: "That one is reserved." });
    expect(await usernameAvailability("anita", null)).toMatchObject({ available: false, reason: "Taken." });
    expect(await usernameAvailability("ANITA", anita)).toMatchObject({ available: true });
    expect(await usernameAvailability("free_one", null)).toMatchObject({ available: true, username: "free_one" });
  });
});

describe("searchUsers", () => {
  it("finds organizers by handle prefix, never staff or the searcher", async () => {
    const me = await makeUser({ username: "anna_me" });
    await makeUser({ username: "anna_k", name: "Anna K" });
    await makeUser({ username: "annabel" });
    await makeUser({ username: "anna_staff", role: "superadmin" });
    await makeUser({ username: "bob" });
    const found = await searchUsers("@ANNA", me);
    expect(found.map((user) => user.username)).toEqual(["anna_k", "annabel"]);
  });

  it("treats an underscore as itself, not as any character", async () => {
    const me = await makeUser();
    await makeUser({ username: "a_bc" });
    await makeUser({ username: "axbc" });
    expect((await searchUsers("a_", me)).map((user) => user.username)).toEqual(["a_bc"]);
  });

  it("returns no email through the route", async () => {
    const me = await makeUser();
    await makeUser({ username: "anna_k", email: "anna@example.test" });
    signedInAs(me);
    const response = await search(new Request("http://localhost/api/users/search?q=ann"));
    const body = JSON.stringify(await response.json());
    expect(body).toContain("anna_k");
    expect(body).not.toContain("anna@example.test");
  });

  it("is closed to anyone signed out", async () => {
    expect((await search(new Request("http://localhost/api/users/search?q=ann"))).status).toBe(401);
  });
});

describe("PATCH /api/me", () => {
  it("changes the name and the handle", async () => {
    const me = await makeUser({ username: "old_handle" });
    signedInAs(me);
    const response = await patchMe(json("PATCH", { name: "New Name", username: "New_Handle" }));
    expect(response.status).toBe(200);
    const [row] = await testDb.select().from(users).where(eq(users.id, me));
    expect(row).toMatchObject({ name: "New Name", username: "new_handle" });
  });

  it("explains a refused handle", async () => {
    const me = await makeUser();
    signedInAs(me);
    const response = await patchMe(json("PATCH", { username: "support" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/reserved/);
  });
});

describe("POST /api/me/password", () => {
  it("needs the current password, and ends every session when it changes", async () => {
    const me = await makeUser({ passwordHash: await hashPassword("old-password-1"), email: "me@example.test" });
    signedInAs(me);
    expect((await changePassword(json("POST", { current: "wrong-password", next: "brand-new-pass-2" }))).status).toBe(400);

    const response = await changePassword(json("POST", { current: "old-password-1", next: "brand-new-pass-2" }));
    expect(response.status).toBe(200);
    const [row] = await testDb.select().from(users).where(eq(users.id, me));
    expect(await verifyPassword("brand-new-pass-2", row.passwordHash ?? "")).toBe(true);
    expect(row.credentialVersion).toBe(1);
  });
});
