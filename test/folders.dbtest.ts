import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const {
  createFolder,
  deleteFolder,
  FolderError,
  galleryFolders,
  listFolders,
  reorderFolders,
  restoreFolders,
  trashedFolders,
  updateFolder,
} = await import("@/lib/folders");
const { albums } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const make = (eventId: string, name: string, parentId: string | null = null) =>
  createFolder({ eventId, name, parentId, maxFolders: 50 });

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof FolderError) return error.reason;
    throw error;
  }
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the folder tree", () => {
  it("nests three levels and refuses a fourth", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "Ceremony");
    const b = await make(eventId, "Vows", a.id);
    const c = await make(eventId, "Rings", b.id);
    expect(await refusal(make(eventId, "Too deep", c.id))).toBe("too_deep");
    expect((await listFolders(eventId)).map((folder) => folder.name).sort()).toEqual(["Ceremony", "Rings", "Vows"]);
  });

  it("refuses a folder inside itself or inside its own subfolder", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "A");
    const b = await make(eventId, "B", a.id);
    expect(await refusal(updateFolder(eventId, a.id, { parentId: a.id }))).toBe("cycle");
    expect(await refusal(updateFolder(eventId, a.id, { parentId: b.id }))).toBe("cycle");
  });

  it("counts a moved folder's own subfolders against the limit", async () => {
    const eventId = await makeEvent(await makeUser());
    const x = await make(eventId, "X");
    const y = await make(eventId, "Y", x.id);
    const a = await make(eventId, "A");
    await make(eventId, "B", a.id);
    // Y is level 2, and A brings a level of its own: 2 + 2 is four.
    expect(await refusal(updateFolder(eventId, a.id, { parentId: y.id }))).toBe("too_deep");
    expect(await refusal(updateFolder(eventId, a.id, { parentId: x.id }))).toBeNull();
  });

  it("refuses a parent from another event, at the database as well as here", async () => {
    const owner = await makeUser();
    const mine = await makeEvent(owner);
    const theirs = await makeEvent(owner);
    const elsewhere = await make(theirs, "Elsewhere");
    expect(await refusal(make(mine, "Sneaky", elsewhere.id))).toBe("parent_invalid");
    await expect(
      testDb.insert(albums).values({ id: "direct", eventId: mine, name: "Direct", parentId: elsewhere.id }),
    ).rejects.toThrow();
  });

  it("lets only one of two crossing moves through, so they cannot make a loop", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "A");
    const b = await make(eventId, "B");
    const results = await Promise.all([
      refusal(updateFolder(eventId, a.id, { parentId: b.id })),
      refusal(updateFolder(eventId, b.id, { parentId: a.id })),
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result === "cycle")).toHaveLength(1);
  });

  it("stops at the plan's number of folders, counting every level", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await createFolder({ eventId, name: "A", parentId: null, maxFolders: 2 });
    await createFolder({ eventId, name: "B", parentId: a.id, maxFolders: 2 });
    expect(await refusal(createFolder({ eventId, name: "C", parentId: null, maxFolders: 2 }))).toBe("limit");
  });
});

describe("order and covers", () => {
  it("puts new folders last and reorders one level, ignoring ids from elsewhere", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "A");
    const b = await make(eventId, "B");
    const c = await make(eventId, "C");
    const inside = await make(eventId, "Inside", a.id);
    expect([a.position, b.position, c.position, inside.position]).toEqual([0, 1, 2, 0]);
    expect(await reorderFolders(eventId, null, [c.id, a.id, b.id, inside.id])).toBe(3);
    const order = (await listFolders(eventId)).filter((folder) => !folder.parentId).map((folder) => folder.name);
    expect(order).toEqual(["C", "A", "B"]);
  });

  it("takes a cover only from this event's live media", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const folder = await make(eventId, "A");
    const photo = await makeMedia(eventId);
    const foreign = await makeMedia(await makeEvent(owner));
    expect((await updateFolder(eventId, folder.id, { coverMediaId: photo })).coverMediaId).toBe(photo);
    expect(await refusal(updateFolder(eventId, folder.id, { coverMediaId: foreign }))).toBe("cover_invalid");
    expect((await updateFolder(eventId, folder.id, { coverMediaId: null })).coverMediaId).toBeNull();
  });
});

describe("trash", () => {
  it("trashes a folder with everything beneath it, as one entry, and restores it the same way", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "Ceremony");
    const b = await make(eventId, "Vows", a.id);
    await make(eventId, "Rings", b.id);
    const keep = await make(eventId, "Party");
    const photo = await makeMedia(eventId, { albumId: b.id });

    expect(await deleteFolder(eventId, a.id)).toBe(3);
    expect((await listFolders(eventId)).map((folder) => folder.id)).toEqual([keep.id]);
    const trash = await trashedFolders(eventId);
    expect(trash.map((folder) => [folder.name, folder.folderCount])).toEqual([["Ceremony", 3]]);

    expect(await restoreFolders(eventId, [a.id])).toBe(3);
    expect(await listFolders(eventId)).toHaveLength(4);
    // The photo never lost its place.
    const [row] = await testDb.select({ albumId: sql<string>`album_id` }).from(sql`media`).where(sql`id = ${photo}`);
    expect(row.albumId).toBe(b.id);
  });

  it("brings back a trashed parent when a subfolder trashed on its own is restored", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "A");
    const b = await make(eventId, "B", a.id);
    await deleteFolder(eventId, b.id);
    await testDb.update(albums).set({ deletedAt: sql`deleted_at - interval '1 minute'` }).where(eq(albums.id, b.id));
    await deleteFolder(eventId, a.id);
    expect((await trashedFolders(eventId)).map((folder) => folder.name).sort()).toEqual(["A", "B"]);
    await restoreFolders(eventId, [b.id]);
    expect((await listFolders(eventId)).map((folder) => folder.name).sort()).toEqual(["A", "B"]);
  });

  it("lifts a live subfolder to the top when the purge removes its parent", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await make(eventId, "A");
    const b = await make(eventId, "B", a.id);
    await testDb.delete(albums).where(eq(albums.id, a.id));
    const [left] = await listFolders(eventId);
    expect(left.id).toBe(b.id);
    expect(left.parentId).toBeNull();
  });
});

describe("what a gallery shows", () => {
  it("marks a folder filled when a guest could see something in it, or anywhere beneath it", async () => {
    const eventId = await makeEvent(await makeUser());
    const ceremony = await make(eventId, "Ceremony");
    const vows = await make(eventId, "Vows", ceremony.id);
    const party = await make(eventId, "Party");
    const hidden = await make(eventId, "Hidden");
    await makeMedia(eventId, { albumId: vows.id });
    await makeMedia(eventId, { albumId: party.id, status: "pending" });
    await makeMedia(eventId, { albumId: hidden.id, visibility: "private" });
    const filled = Object.fromEntries((await galleryFolders(eventId)).map((folder) => [folder.name, folder.filled]));
    expect(filled).toEqual({ Ceremony: true, Vows: true, Party: false, Hidden: false });
  });
});
