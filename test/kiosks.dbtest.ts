import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// Cookies and the host's session are set per test; everything else is the
// real code against a real Postgres.
const jar = new Map<string, string>();
let manager: unknown = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
vi.mock("@/lib/roles", () => ({ requireEventManagerSession: async () => manager }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.test/signed" }));

const kiosksLib = await import("@/lib/kiosks");
const { activeKiosk, createKiosk, findPairing, listKiosks, pairKiosk, renewPairCode, revokeKiosk, MAX_KIOSKS_PER_EVENT, KioskLimitError } =
  kiosksLib;
const { resolveEventViewer } = await import("@/lib/event-viewer");
const { guestCookieName, signGuestSession, verifyGuestSession } = await import("@/lib/guest");
const { claimGuestCookies } = await import("@/lib/guest-accounts");
const { POST: pair } = await import("@/app/api/kiosk/pair/route");
const { DELETE: deleteOwn } = await import("@/app/api/e/[slug]/media/[mediaId]/route");
const { DELETE: eraseMe } = await import("@/app/api/e/[slug]/me/route");
const { POST: signUpload } = await import("@/app/api/upload/route");
const { events, guests, kiosks, media } = await import("@/lib/schema");
const { grantEntitlement } = await import("@/lib/entitlements");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];

async function setUp(overrides: Parameters<typeof makeEvent>[1] = {}) {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, overrides);
  // Live, on Premium: a draft is open to nobody, kiosk or not.
  await grantEntitlement({ userId: owner, planKey: "premium", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
  const made = await createKiosk({ eventId, name: "Entrance", albumId: null, createdBy: owner });
  return { owner, eventId, ...made };
}

/** Pairs through the real route and puts the cookie it sets in the jar. */
async function pairThroughRoute(code: string) {
  const response = await pair(
    new Request("https://klik.test/api/kiosk/pair", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ code }),
    }),
  );
  const cookie = response.headers.getSetCookie()[0];
  if (cookie) {
    const [pairText] = cookie.split(";");
    const index = pairText.indexOf("=");
    jar.set(pairText.slice(0, index), pairText.slice(index + 1));
  }
  return response;
}

beforeEach(async () => {
  jar.clear();
  manager = null;
  await resetDatabase();
});

afterAll(closeDatabase);

describe("pairing", () => {
  it("works once, gives the tablet the kiosk's guest and nothing else, and says where to go", async () => {
    const { eventId, kiosk, code } = await setUp();
    expect((await findPairing(code))?.kioskName).toBe("Entrance");

    const response = await pairThroughRoute(code);
    expect(response.status).toBe(200);
    expect((await response.json()).slug).toBe((await eventRow(eventId)).slug);
    const session = await verifyGuestSession(jar.get(guestCookieName(eventId))!);
    expect(session).toEqual({ guestId: kiosk.guestId, eventId, kioskId: kiosk.id });

    expect(await findPairing(code)).toBeNull();
    expect((await pairThroughRoute(code)).status).toBe(404);
  });

  it("refuses a code past its thirty minutes, a switched-off kiosk, and anything not shaped like a code", async () => {
    const { eventId, kiosk, code } = await setUp();
    await testDb.update(kiosks).set({ pairExpiresAt: sql`now() - interval '1 minute'` }).where(eq(kiosks.id, kiosk.id));
    expect(await pairKiosk(code)).toBeNull();

    const fresh = (await renewPairCode(eventId, kiosk.id))!;
    await revokeKiosk(eventId, kiosk.id);
    expect(await pairKiosk(fresh)).toBeNull();
    expect(await renewPairCode(eventId, kiosk.id)).toBeNull();
    expect(await pairKiosk("../../not-a-code")).toBeNull();
  });

  it("lets only one of two racing tablets have a link", async () => {
    const { code } = await setUp();
    const results = await Promise.all([pairKiosk(code), pairKiosk(code), pairKiosk(code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps only a hash of the code", async () => {
    const { kiosk, code } = await setUp();
    const [row] = await testDb.select().from(kiosks).where(eq(kiosks.id, kiosk.id));
    expect(row.pairCodeHash).not.toContain(code);
    expect(row.pairCodeHash).toHaveLength(64);
  });

  it("stops at the per-event limit, and a switched-off kiosk frees its place", async () => {
    const { eventId, owner, kiosk } = await setUp();
    for (let index = 1; index < MAX_KIOSKS_PER_EVENT; index += 1) {
      await createKiosk({ eventId, name: `K${index}`, albumId: null, createdBy: owner });
    }
    await expect(createKiosk({ eventId, name: "One more", albumId: null, createdBy: owner })).rejects.toBeInstanceOf(KioskLimitError);
    await revokeKiosk(eventId, kiosk.id);
    await expect(createKiosk({ eventId, name: "One more", albumId: null, createdBy: owner })).resolves.toBeTruthy();
  });
});

describe("a paired tablet", () => {
  it("is a guest who may upload, until the host switches it off", async () => {
    const { eventId, kiosk, code } = await setUp();
    await pairThroughRoute(code);
    const event = await eventRow(eventId);

    const viewer = await resolveEventViewer(event);
    expect(viewer.guestId).toBe(kiosk.guestId);
    expect(viewer.kioskId).toBe(kiosk.id);

    await revokeKiosk(eventId, kiosk.id);
    const after = await resolveEventViewer(event);
    expect(after.guestId).toBeNull();
    expect(after.kioskId).toBeNull();
  });

  it("stands in for the gallery password, and not for a private gallery", async () => {
    const { eventId, code } = await setUp({ visibility: "password", passwordHash: "x" });
    await pairThroughRoute(code);
    expect((await resolveEventViewer(await eventRow(eventId))).access.allowed).toBe(true);
    await testDb.update(events).set({ visibility: "private" }).where(eq(events.id, eventId));
    expect((await resolveEventViewer(await eventRow(eventId))).access.allowed).toBe(false);
  });

  it("is not fooled by a kiosk claim on another guest's cookie", async () => {
    const { eventId, kiosk } = await setUp();
    const someone = await makeGuest(eventId);
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: someone, eventId, kioskId: kiosk.id }));
    const viewer = await resolveEventViewer(await eventRow(eventId));
    expect(viewer.guestId).toBeNull();
    expect(await activeKiosk({ kioskId: kiosk.id, guestId: someone, eventId })).toBeNull();
  });

  it("cannot delete a photo, or erase itself and every photo it took", async () => {
    const { eventId, kiosk, code } = await setUp();
    await pairThroughRoute(code);
    const { slug } = await eventRow(eventId);
    const photo = await makeMedia(eventId, { guestId: kiosk.guestId });

    const deleted = await deleteOwn(
      new Request(`https://klik.test/api/e/${slug}/media/${photo}`, { method: "DELETE", headers: { "x-forwarded-for": "203.0.113.9" } }),
      { params: Promise.resolve({ slug, mediaId: photo }) },
    );
    expect(deleted.status).toBe(403);
    const erased = await eraseMe(new Request(`https://klik.test/api/e/${slug}/me`, { method: "DELETE" }), {
      params: Promise.resolve({ slug }),
    });
    expect(erased.status).toBe(403);
    expect((await testDb.select().from(media).where(eq(media.id, photo)))[0].deletedAt).toBeNull();
    expect(await testDb.select().from(guests).where(eq(guests.id, kiosk.guestId))).toHaveLength(1);
  });

  it("has no disposable roll, because a kiosk is a queue of guests, while a guest's spent roll still stops", async () => {
    const { eventId, kiosk, code } = await setUp({ disposableMode: true, shotsPerGuest: 1 });
    await pairThroughRoute(code);
    await testDb.update(guests).set({ shotsUsed: 5 }).where(eq(guests.id, kiosk.guestId));
    const ask = (mediaId: string) =>
      signUpload(
        new Request("https://klik.test/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20" },
          body: JSON.stringify({ eventId, mediaId, mimeType: "image/jpeg", sizeBytes: 1000 }),
        }),
      );
    expect((await ask("kiosk_photo_0001")).status).toBe(200);

    const guest = await makeGuest(eventId, { shotsUsed: 1 });
    jar.set(guestCookieName(eventId), await signGuestSession({ guestId: guest, eventId }));
    expect((await ask("guest_photo_0001")).status).toBe(403);
  });

  it("is never claimed by whoever signs in on it", async () => {
    const { eventId, kiosk, code } = await setUp();
    await pairThroughRoute(code);
    const name = guestCookieName(eventId);
    expect(await claimGuestCookies(await makeUser(), [{ name, value: jar.get(name)! }])).toBe(0);
    expect((await testDb.select().from(guests).where(eq(guests.id, kiosk.guestId)))[0].userId).toBeNull();
  });
});

describe("the dashboard list", () => {
  it("counts each kiosk's live photos and says whether its link is still open", async () => {
    const { eventId, kiosk, code } = await setUp();
    await makeMedia(eventId, { guestId: kiosk.guestId });
    await makeMedia(eventId, { guestId: kiosk.guestId, deletedAt: new Date() });
    await makeMedia(eventId);
    expect((await listKiosks(eventId))[0]).toMatchObject({ name: "Entrance", photos: 1, pairingOpen: true, pairedAt: null });
    await pairKiosk(code);
    const [row] = await listKiosks(eventId);
    expect(row.pairingOpen).toBe(false);
    expect(row.pairedAt).not.toBeNull();
  });
});
