import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Who is asking comes from cookies, which a test does not have; the viewer is
// set per test. R2 is stubbed at the signing step, so the route runs for real
// up to the URL it would redirect to.
const viewer = { access: { allowed: true } as { allowed: boolean }, guestId: null as string | null, ownerSession: null as unknown };
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));
vi.mock("@/lib/storage", () => ({ r2: {}, extensionForMime: () => "jpg" }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://r2.test/signed" }));

const { GET: download } = await import("@/app/api/e/[slug]/media/[mediaId]/download/route");
const { fetchGalleryMedia } = await import("@/lib/media");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");
const { events } = await import("@/lib/schema");
const { eq } = await import("drizzle-orm");

async function downloadStatus(slug: string, mediaId: string) {
  const response = await download(new Request(`https://klik.test/api/e/${slug}/media/${mediaId}/download`), {
    params: Promise.resolve({ slug, mediaId }),
  });
  return response.status;
}

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];

beforeEach(async () => {
  viewer.access = { allowed: true };
  viewer.guestId = null;
  viewer.ownerSession = null;
  await resetDatabase();
});

afterAll(closeDatabase);

describe("saving a photo", () => {
  it("lets a guest save their own upload when the host has turned downloads off, and nobody else's", async () => {
    const eventId = await makeEvent(await makeUser(), { downloadsEnabled: false });
    const { slug } = await eventRow(eventId);
    const mine = await makeGuest(eventId);
    const theirs = await makeGuest(eventId);
    const own = await makeMedia(eventId, { guestId: mine });
    const other = await makeMedia(eventId, { guestId: theirs });

    viewer.guestId = mine;
    expect(await downloadStatus(slug, own)).toBe(307);
    expect(await downloadStatus(slug, other)).toBe(403);
  });

  it("still hides what the guest may not see, with downloads on", async () => {
    const eventId = await makeEvent(await makeUser(), { downloadsEnabled: true });
    const { slug } = await eventRow(eventId);
    const guest = await makeGuest(eventId);
    const someone = await makeGuest(eventId);
    const shown = await makeMedia(eventId, { guestId: someone });
    const held = await makeMedia(eventId, { guestId: someone, status: "pending" });

    viewer.guestId = guest;
    expect(await downloadStatus(slug, shown)).toBe(307);
    expect(await downloadStatus(slug, held)).toBe(404);
  });

  it("asks a visitor who has not joined to join first", async () => {
    const eventId = await makeEvent(await makeUser(), { downloadsEnabled: false });
    const { slug } = await eventRow(eventId);
    const photo = await makeMedia(eventId);
    expect(await downloadStatus(slug, photo)).toBe(401);
  });
});

describe("a link to one photo", () => {
  it("opens only what the grid would show the same viewer", async () => {
    const eventId = await makeEvent(await makeUser());
    const event = await eventRow(eventId);
    const guest = await makeGuest(eventId);
    const someone = await makeGuest(eventId);
    const shown = await makeMedia(eventId, { guestId: someone });
    const held = await makeMedia(eventId, { guestId: someone, status: "pending" });
    const ownHeld = await makeMedia(eventId, { guestId: guest, status: "pending" });
    const trashed = await makeMedia(eventId, { deletedAt: new Date() });

    const one = (id: string, isOwner = false) =>
      fetchGalleryMedia(eventId, { isOwner, guestId: isOwner ? null : guest, event, id, limit: 1 });
    expect((await one(shown)).map((row) => row.id)).toEqual([shown]);
    expect(await one(held)).toEqual([]);
    expect((await one(ownHeld)).map((row) => row.id)).toEqual([ownHeld]);
    expect(await one(trashed)).toEqual([]);
    // The host sees what is waiting for them, and still not the trash.
    expect((await one(held, true)).map((row) => row.id)).toEqual([held]);
    expect(await one(trashed, true)).toEqual([]);
  });

  it("never reaches into another event", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const elsewhere = await makeMedia(await makeEvent(owner));
    const event = await eventRow(eventId);
    expect(await fetchGalleryMedia(eventId, { isOwner: true, event, id: elsewhere, limit: 1 })).toEqual([]);
  });
});
