import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { eq } from "drizzle-orm";

let session: Session | null = null;
const deleteBlobs = vi.fn(async (keys: string[]) => {
  void keys;
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  deleteBlobs,
}));

const { claimGuestCookies, joinedGalleries, forgetGallery } = await import("@/lib/guest-accounts");
const { POST: join } = await import("@/app/api/e/[slug]/session/route");
const { DELETE: forgetRoute } = await import("@/app/api/me/galleries/[eventId]/route");
const { eraseGuest, eraseUser, LegalHoldError } = await import("@/lib/erasure");
const { getPendingSignups } = await import("@/lib/billing-admin");
const { guestCookieName, signGuestSession, verifyGuestSession } = await import("@/lib/guest");
const { events, guests, media, users } = await import("@/lib/schema");
const { closeDatabase, daysFromNow, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import(
  "./harness"
);

const signedInAs = (id: string | null) => {
  session = id ? ({ user: { id, role: "organizer" }, expires: daysFromNow(30).toISOString() } as unknown as Session) : null;
};

/** A live, public gallery a guest can join. */
async function gallery(owner?: string) {
  return makeEvent(owner ?? (await makeUser()), { planKey: "premium", licensedAt: new Date() });
}

async function slugOf(eventId: string) {
  return (await testDb.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)))[0].slug;
}

async function joinAs(eventId: string, name = "Guest") {
  const response = await join(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ name, consent: true }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ slug: await slugOf(eventId) }) },
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  const token = new RegExp(`${guestCookieName(eventId)}=([^;]+)`).exec(cookie)?.[1];
  return { status: response.status, guest: token ? await verifyGuestSession(token) : null };
}

const cookieFor = async (guestId: string, eventId: string) => ({
  name: guestCookieName(eventId),
  value: await signGuestSession({ guestId, eventId }),
});

beforeEach(async () => {
  session = null;
  deleteBlobs.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("ACC-3 claiming anonymous guests", () => {
  it("attaches the guests this browser holds to the account", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    expect(await claimGuestCookies(me, [await cookieFor(guestId, eventId)])).toBe(1);
    const [row] = await testDb.select().from(guests).where(eq(guests.id, guestId));
    expect(row.userId).toBe(me);
  });

  it("never moves a guest that already belongs to someone else", async () => {
    const first = await makeUser();
    const second = await makeUser();
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    const cookie = await cookieFor(guestId, eventId);
    await claimGuestCookies(first, [cookie]);
    expect(await claimGuestCookies(second, [cookie])).toBe(0);
    const [row] = await testDb.select().from(guests).where(eq(guests.id, guestId));
    expect(row.userId).toBe(first);
  });

  it("ignores a cookie that is forged, or filed under another event's name", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    const otherEvent = await gallery();
    const guestId = await makeGuest(eventId);
    const misfiled = { name: guestCookieName(otherEvent), value: (await cookieFor(guestId, eventId)).value };
    const forged = { name: guestCookieName(eventId), value: "not-a-token" };
    expect(await claimGuestCookies(me, [misfiled, forged, { name: "unrelated", value: "x" }])).toBe(0);
  });
});

describe("ACC-5 joining while signed in", () => {
  it("records the account on the guest, and resumes that guest on a new phone", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    signedInAs(me);
    const first = await joinAs(eventId, "Ana");
    expect(first.status).toBe(200);
    const [row] = await testDb.select().from(guests).where(eq(guests.id, first.guest!.guestId));
    expect(row.userId).toBe(me);

    const photo = await makeMedia(eventId, { guestId: first.guest!.guestId });
    // A second phone: no cookie, same account, and no name typed this time.
    const second = await joinAs(eventId, "");
    expect(second.guest?.guestId).toBe(first.guest?.guestId);
    expect(await testDb.select().from(guests).where(eq(guests.eventId, eventId))).toHaveLength(1);
    // And the name is not wiped by joining again without one.
    const [after] = await testDb.select().from(guests).where(eq(guests.id, first.guest!.guestId));
    expect(after.displayName).toBe("Ana");
    void photo;
  });

  it("still makes an anonymous guest for anyone signed out", async () => {
    const eventId = await gallery();
    const joined = await joinAs(eventId);
    const [row] = await testDb.select().from(guests).where(eq(guests.id, joined.guest!.guestId));
    expect(row.userId).toBeNull();
  });
});

describe("ACC-4 joinedGalleries and forgetting one", () => {
  it("lists galleries joined, counting only uploads still there", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    await testDb.update(guests).set({ userId: me }).where(eq(guests.id, guestId));
    await makeMedia(eventId, { guestId });
    await makeMedia(eventId, { guestId, deletedAt: new Date() });
    const deletedEvent = await gallery();
    const ghost = await makeGuest(deletedEvent);
    await testDb.update(guests).set({ userId: me }).where(eq(guests.id, ghost));
    await testDb.update(events).set({ deletedAt: new Date() }).where(eq(events.id, deletedEvent));

    const list = await joinedGalleries(me);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ eventId, uploads: 1 });
  });

  it("erases everything the account shared at one event, from every phone", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    const phoneA = await makeGuest(eventId);
    const phoneB = await makeGuest(eventId);
    await testDb.update(guests).set({ userId: me }).where(eq(guests.eventId, eventId));
    const someoneElse = await makeGuest(eventId);
    await makeMedia(eventId, { guestId: phoneA });
    await makeMedia(eventId, { guestId: phoneB });
    const theirs = await makeMedia(eventId, { guestId: someoneElse });

    const result = await forgetGallery(me, eventId);
    expect(result).toMatchObject({ guests: 2, mediaDeleted: 2 });
    const left = await testDb.select().from(media).where(eq(media.eventId, eventId));
    expect(left.map((row) => row.id)).toEqual([theirs]);
  });

  it("answers 404 through the route when the account was never there", async () => {
    signedInAs(await makeUser());
    const response = await forgetRoute(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ eventId: await gallery() }),
    });
    expect(response.status).toBe(404);
  });
});

describe("eraseUser and a guest's uploads elsewhere", () => {
  it("erases what the account shared at other people's events", async () => {
    const me = await makeUser();
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    await testDb.update(guests).set({ userId: me }).where(eq(guests.id, guestId));
    await makeMedia(eventId, { guestId });
    await eraseUser(me, me);
    expect(await testDb.select().from(media).where(eq(media.eventId, eventId))).toHaveLength(0);
    expect(await testDb.select().from(guests).where(eq(guests.id, guestId))).toHaveLength(0);
  });

  it("stops before deleting anything when one of those uploads is held", async () => {
    const me = await makeUser();
    await makeEvent(me);
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    await testDb.update(guests).set({ userId: me }).where(eq(guests.id, guestId));
    await makeMedia(eventId, { guestId, legalHoldAt: new Date() });
    await expect(eraseUser(me, me)).rejects.toBeInstanceOf(LegalHoldError);
    expect(await testDb.select().from(users).where(eq(users.id, me))).toHaveLength(1);
  });
});

describe("eraseGuest", () => {
  it("clears the event cover when it was any of the guest's uploads, not only the first", async () => {
    const eventId = await gallery();
    const guestId = await makeGuest(eventId);
    await makeMedia(eventId, { guestId, createdAt: new Date(Date.now() - 60_000) });
    const second = await makeMedia(eventId, { guestId });
    await testDb.update(events).set({ coverMediaId: second }).where(eq(events.id, eventId));
    await eraseGuest(guestId, eventId, null);
    const [row] = await testDb.select().from(events).where(eq(events.id, eventId));
    expect(row.coverMediaId).toBeNull();
  });
});

describe("getPendingSignups", () => {
  it("lists accounts that came to run events, and not guests keeping a gallery", async () => {
    const buyer = await makeUser({ organizerIntentAt: new Date() });
    const guestAccount = await makeUser();
    const drafter = await makeUser();
    await makeEvent(drafter);
    const ids = (await getPendingSignups()).map((row) => row.userId);
    expect(ids).toContain(buyer);
    expect(ids).toContain(drafter);
    expect(ids).not.toContain(guestAccount);
  });
});
