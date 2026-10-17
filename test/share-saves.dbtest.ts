import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ACC-7: a link opened while signed in is kept for that account, once, and
 * /me lists it only while it still opens.
 */

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { rememberShare, sharedWith } = await import("@/lib/share-saves");
const { shareSaves } = await import("@/lib/schema");
const { closeDatabase, daysFromNow, makeEvent, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("ACC-7 shared with you", () => {
  it("keeps one row per account and link however often it is opened", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const eventId = await makeEvent(owner, { name: "Ana & Bo" });
    const mediaId = await makeMedia(eventId);
    const shareId = await makeShare(eventId, { mediaId });
    await rememberShare(viewer, shareId);
    await rememberShare(viewer, shareId);
    expect(await testDb.select().from(shareSaves)).toHaveLength(1);
    expect(await sharedWith(viewer)).toEqual([
      expect.objectContaining({ token: `tok_${shareId}`, eventName: "Ana & Bo", what: "A photo" }),
    ]);
    expect(await sharedWith(owner)).toEqual([]);
  });

  it("drops a link once it is turned off, runs out, or its event is gone", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const open = await makeEvent(owner);
    const gone = await makeEvent(owner, { deletedAt: new Date() });
    const paused = await makeEvent(owner, { suspendedAt: new Date(), suspendedReason: "Under review" });
    const ids = [
      await makeShare(open, { mediaId: await makeMedia(open) }),
      await makeShare(open, { mediaId: await makeMedia(open), revokedAt: new Date() }),
      await makeShare(open, { mediaId: await makeMedia(open), expiresAt: daysFromNow(-1) }),
      await makeShare(gone, { mediaId: await makeMedia(gone) }),
      await makeShare(paused, { mediaId: await makeMedia(paused) }),
    ];
    for (const id of ids) await rememberShare(viewer, id);
    const listed = await sharedWith(viewer);
    expect(listed.map((link) => link.token)).toEqual([`tok_${ids[0]}`]);
  });
});
