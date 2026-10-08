import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { spendShot } = await import("@/lib/disposable");
const { fetchGalleryMedia } = await import("@/lib/media");
const { guests } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("spendShot", () => {
  it("gives the last frame to exactly one of several uploads racing for it", async () => {
    const eventId = await makeEvent(await makeUser(), { disposableMode: true, shotsPerGuest: 24 });
    const guest = await makeGuest(eventId);
    await testDb.update(guests).set({ shotsUsed: 23 }).where(eq(guests.id, guest));
    const results = await Promise.all(Array.from({ length: 5 }, () => spendShot(guest, 24)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await testDb.select().from(guests).where(eq(guests.id, guest)))[0].shotsUsed).toBe(24);
  });
});

describe("an undeveloped roll", () => {
  it("shows a guest nothing, not even their own photo, and shows the host everything", async () => {
    const owner = await makeUser();
    const developsAt = new Date(Date.now() + 60 * 60 * 1000);
    const event = { uploaderSeesOwnPrivate: true, disposableMode: true, developsAt };
    const eventId = await makeEvent(owner, event);
    const guest = await makeGuest(eventId);
    await makeMedia(eventId, { guestId: guest });

    expect(await fetchGalleryMedia(eventId, { isOwner: false, guestId: guest, event })).toHaveLength(0);
    expect(await fetchGalleryMedia(eventId, { isOwner: true, guestId: null, event })).toHaveLength(1);
  });

  it("reveals everything once the develop time has passed", async () => {
    const owner = await makeUser();
    const event = { uploaderSeesOwnPrivate: true, disposableMode: true, developsAt: new Date(Date.now() - 1000) };
    const eventId = await makeEvent(owner, event);
    await makeMedia(eventId);
    expect(await fetchGalleryMedia(eventId, { isOwner: false, guestId: null, event })).toHaveLength(1);
  });

  it("stays dark when the host has not set a time, until they develop it", async () => {
    const owner = await makeUser();
    const event = { uploaderSeesOwnPrivate: true, disposableMode: true, developsAt: null };
    const eventId = await makeEvent(owner, event);
    await makeMedia(eventId);
    expect(await fetchGalleryMedia(eventId, { isOwner: false, guestId: null, event })).toHaveLength(0);
  });
});
