import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Session } from "next-auth";

/**
 * MED-16: a host's order for the photos in a folder, saved in one go, kept
 * when photos arrive, lost by a photo that moves out, and followed by a link
 * to the folder page by page.
 */

let session: Session | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

const orderRoute = await import("@/app/api/events/[id]/albums/[albumId]/order/route");
const { listCollectionItems } = await import("@/lib/shares");
const { grantEntitlement } = await import("@/lib/entitlements");
const { albums, events, media, mediaShares } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session = null;
  await resetDatabase();
});
afterAll(closeDatabase);

const signIn = (id: string) => {
  session = { user: { id, role: "organizer" }, expires: new Date(Date.now() + 86_400_000).toISOString() } as unknown as Session;
};

/** Five photos in a folder, a minute apart, newest last made. */
async function setUp() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  await grantEntitlement({ userId: owner, planKey: "event", source: "admin", reason: "Test", grantedBy: null, applyToEventId: eventId });
  await testDb.insert(albums).values([
    { id: "alb_order", eventId, name: "Ceremony" },
    { id: "alb_other", eventId, name: "Party" },
  ]);
  const ids: string[] = [];
  for (let index = 0; index < 5; index++) {
    ids.push(await makeMedia(eventId, { id: `med_${index}`, albumId: "alb_order", createdAt: new Date(Date.UTC(2026, 5, 13, 18, index)) }));
  }
  return { owner, eventId, ids };
}

const call = (method: "PUT" | "DELETE", eventId: string, body?: unknown, albumId = "alb_order") =>
  orderRoute[method](
    new Request(`https://klik.test/api/events/${eventId}/albums/${albumId}/order`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ id: eventId, albumId }) },
  );

const positions = async (ids: string[]) =>
  Object.fromEntries(
    (await testDb.select({ id: media.id, p: media.folderPosition }).from(media).where(inArray(media.id, ids))).map((row) => [row.id, row.p]),
  );

describe("MED-16 saving an order", () => {
  it("places what it is sent, in that order, and only for the team", async () => {
    const { owner, eventId, ids } = await setUp();
    expect((await call("PUT", eventId, { ids: [ids[2], ids[0]] })).status).toBe(401);

    signIn(owner);
    const response = await call("PUT", eventId, { ids: [ids[2], ids[0], ids[4]] });
    expect(response.status).toBe(200);
    expect(await positions(ids)).toEqual({ [ids[0]]: 1, [ids[1]]: null, [ids[2]]: 0, [ids[3]]: null, [ids[4]]: 2 });

    // A second order replaces the first: what it leaves out has no place.
    await call("PUT", eventId, { ids: [ids[1]] });
    expect(await positions(ids)).toEqual({ [ids[0]]: null, [ids[1]]: 0, [ids[2]]: null, [ids[3]]: null, [ids[4]]: null });
  });

  it("refuses a photo that is not in the folder any more, and changes nothing", async () => {
    const { owner, eventId, ids } = await setUp();
    signIn(owner);
    await testDb.update(media).set({ albumId: "alb_other" }).where(eq(media.id, ids[3]));
    const response = await call("PUT", eventId, { ids: [ids[3], ids[0]] });
    expect(response.status).toBe(409);
    expect(Object.values(await positions(ids)).every((place) => place === null)).toBe(true);
  });

  it("forgets a photo's place when it moves folder, tells open galleries, and goes back to newest first", async () => {
    const { owner, eventId, ids } = await setUp();
    signIn(owner);
    const [before] = await testDb.select({ changedAt: media.changedAt }).from(media).where(eq(media.id, ids[0]));
    await call("PUT", eventId, { ids: [ids[0], ids[1]] });
    const [after] = await testDb.select({ changedAt: media.changedAt }).from(media).where(eq(media.id, ids[0]));
    expect(after.changedAt!.getTime()).toBeGreaterThan(before.changedAt!.getTime());

    await testDb.update(media).set({ albumId: "alb_other" }).where(eq(media.id, ids[1]));
    expect((await positions([ids[1]]))[ids[1]]).toBeNull();

    expect((await call("DELETE", eventId)).status).toBe(200);
    expect((await positions([ids[0]]))[ids[0]]).toBeNull();
  });
});

describe("MED-16 a link to an arranged folder", () => {
  it("shows the placed photos first in their order, then the rest newest first, across pages", async () => {
    const { owner, eventId, ids } = await setUp();
    signIn(owner);
    await call("PUT", eventId, { ids: [ids[1], ids[3]] });
    const shareId = await makeShare(eventId, { scope: "album", albumId: "alb_order" });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
    const [event] = await testDb.select().from(events).where(eq(events.id, eventId));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listCollectionItems>> = await listCollectionItems(share, event, { cursor, limit: 2 });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([ids[1], ids[3], ids[4], ids[2], ids[0]]);
  });

  it("reads as newest first for a folder nobody arranged, and accepts a cursor from before", async () => {
    const { eventId, ids } = await setUp();
    const shareId = await makeShare(eventId, { scope: "album", albumId: "alb_order" });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
    const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
    const first = await listCollectionItems(share, event, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([ids[4], ids[3]]);
    const oldStyle = `${new Date(Date.UTC(2026, 5, 13, 18, 3)).toISOString()}~${ids[3]}`;
    expect((await listCollectionItems(share, event, { cursor: oldStyle, limit: 5 })).items.map((item) => item.id)).toEqual([ids[2], ids[1], ids[0]]);
  });
});
