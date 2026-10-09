import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { refreshMoments } = await import("@/lib/job-handlers/moments");
const { createFolder, galleryMoments, updateFolder } = await import("@/lib/folders");
const { albums, events, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

/** n photos every `everySeconds` from a wall time, uploaded a few minutes later in UTC-4. */
async function shoot(eventId: string, startWall: string, n: number, everySeconds: number, extra = {}) {
  const ids: string[] = [];
  for (let index = 0; index < n; index += 1) {
    const wall = new Date(Date.parse(`${startWall}Z`) + index * everySeconds * 1000).toISOString().slice(0, 19);
    ids.push(
      await makeMedia(eventId, {
        capturedAt: wall.replace("T", " "),
        createdAt: new Date(Date.parse(`${wall}Z`) + 4 * 3_600_000 + 3 * 60_000),
        ...extra,
      }),
    );
  }
  return ids;
}

const smart = (eventId: string) =>
  testDb
    .select()
    .from(albums)
    .where(and(eq(albums.eventId, eventId), eq(albums.kind, "smart")))
    .orderBy(albums.position);

const momentOf = async (id: string) =>
  (await testDb.select({ momentId: media.momentId, burstId: media.burstId }).from(media).where(eq(media.id, id)))[0];

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("refreshMoments", () => {
  it("stores each moment as a smart folder and files every photo into one", async () => {
    const eventId = await makeEvent(await makeUser());
    const ceremony = await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    const party = await shoot(eventId, "2026-07-04T20:00:00", 10, 40);
    await refreshMoments({ eventId });

    const rows = await smart(eventId);
    expect(rows.map((row) => row.name)).toEqual(["Afternoon", "Evening"]);
    expect((await momentOf(ceremony[0])).momentId).toBe(rows[0].id);
    expect((await momentOf(party[9])).momentId).toBe(rows[1].id);

    const listed = await galleryMoments({ id: eventId, momentsEnabled: true }, { isManager: false });
    expect(listed.map((moment) => [moment.name, moment.count])).toEqual([
      ["Afternoon", 8],
      ["Evening", 10],
    ]);
  });

  it("keeps a moment's id, and the host's name for it, as photos keep arriving", async () => {
    const eventId = await makeEvent(await makeUser());
    await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    await shoot(eventId, "2026-07-04T20:00:00", 8, 40);
    await refreshMoments({ eventId });
    const [afternoon] = await smart(eventId);
    await updateFolder(eventId, afternoon.id, { name: "Ceremony" });

    await shoot(eventId, "2026-07-04T14:06:00", 4, 30);
    await refreshMoments({ eventId });
    const after = await smart(eventId);
    expect(after[0].id).toBe(afternoon.id);
    expect(after[0].name).toBe("Ceremony");
    expect((await galleryMoments({ id: eventId, momentsEnabled: true }, { isManager: true }))[0].count).toBe(12);
  });

  it("makes no moments for one stretch of time, and takes away ones that no longer stand", async () => {
    const eventId = await makeEvent(await makeUser());
    await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    const evening = await shoot(eventId, "2026-07-04T20:00:00", 8, 40);
    await refreshMoments({ eventId });
    expect(await smart(eventId)).toHaveLength(2);

    await testDb.update(media).set({ deletedAt: new Date() }).where(sql`${media.id} IN ${evening}`);
    await refreshMoments({ eventId });
    expect(await smart(eventId)).toHaveLength(0);
  });

  it("stacks a burst behind its first photo", async () => {
    const eventId = await makeEvent(await makeUser());
    const burst = await shoot(eventId, "2026-07-04T21:00:00", 6, 1);
    const single = await shoot(eventId, "2026-07-04T21:10:00", 1, 1);
    await refreshMoments({ eventId });
    expect((await Promise.all(burst.map(momentOf))).every((row) => row.burstId === burst[0])).toBe(true);
    expect((await momentOf(single[0])).burstId).toBeNull();
  });

  it("stamps the event only when something moved, so phones resync once", async () => {
    const eventId = await makeEvent(await makeUser());
    await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    await shoot(eventId, "2026-07-04T20:00:00", 8, 40);
    await refreshMoments({ eventId });
    await testDb.update(events).set({ updatedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(events.id, eventId));
    await refreshMoments({ eventId });
    const [row] = await testDb.select({ updatedAt: events.updatedAt }).from(events).where(eq(events.id, eventId));
    expect(row.updatedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("moments beside folders", () => {
  it("never count against the folder limit, and cannot be moved or given a cover", async () => {
    const eventId = await makeEvent(await makeUser());
    await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    await shoot(eventId, "2026-07-04T20:00:00", 8, 40);
    await refreshMoments({ eventId });
    const folder = await createFolder({ eventId, name: "Only folder", parentId: null, maxFolders: 1 });
    expect(folder.name).toBe("Only folder");
    const [moment] = await smart(eventId);
    await expect(updateFolder(eventId, moment.id, { parentId: folder.id })).rejects.toThrow();
  });

  it("shows guests only what they can see, and nothing when the host has moments off", async () => {
    const eventId = await makeEvent(await makeUser());
    await shoot(eventId, "2026-07-04T14:00:00", 8, 40);
    await shoot(eventId, "2026-07-04T20:00:00", 5, 40, { status: "pending" });
    await shoot(eventId, "2026-07-04T20:04:00", 3, 40);
    await refreshMoments({ eventId });
    const guest = await galleryMoments({ id: eventId, momentsEnabled: true }, { isManager: false });
    expect(guest.map((moment) => moment.count)).toEqual([8, 3]);
    expect(await galleryMoments({ id: eventId, momentsEnabled: false }, { isManager: false })).toEqual([]);
    expect(await galleryMoments({ id: eventId, momentsEnabled: false }, { isManager: true })).toHaveLength(2);
  });
});
