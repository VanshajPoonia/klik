import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { newQueuedUpload, type QueuedUpload } from "./record";
import { IdbQueueStore, MemoryQueueStore, PageQueueStore, openQueueDatabase, type QueueStore } from "./store";

const context = { eventId: "e1", slug: "party", albumId: null, maxVideoSeconds: 60 };

function item(id: string, addedAt: number, patch: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    ...newQueuedUpload(id, { file: new File([`bytes of ${id}`], `${id}.jpg`, { type: "image/jpeg" }) }, context, addedAt),
    ready: true,
    ...patch,
  };
}

async function freshStore() {
  return new IdbQueueStore(await openQueueDatabase(new IDBFactory()));
}

describe("the queue on disk", () => {
  it("keeps the file itself, and gives it back whole", async () => {
    const store = await freshStore();
    await store.put(item("a", 1));
    const kept = await store.get("a");
    expect(kept?.file).toBeInstanceOf(Blob);
    expect(await kept!.file.text()).toBe("bytes of a");
    expect((kept!.file as File).name).toBe("a.jpg");
  });

  it("changes an item in one step, and says when it has gone", async () => {
    const store = await freshStore();
    await store.put(item("a", 1));
    const updated = await store.update("a", (current) => ({ sent: { ...current.sent, pathname: "events/e1/a.jpg" } }));
    expect(updated?.sent.pathname).toBe("events/e1/a.jpg");
    expect((await store.get("a"))?.sent.pathname).toBe("events/e1/a.jpg");
    await store.remove("a");
    expect(await store.update("a", () => ({ tries: 1 }))).toBeNull();
    expect(await store.all()).toEqual([]);
  });

  it("never hands one item to two senders, however they race", async () => {
    const factory = new IDBFactory();
    // Two connections, as a page and the service worker would have.
    const page = new IdbQueueStore(await openQueueDatabase(factory));
    const worker = new IdbQueueStore(await openQueueDatabase(factory));
    for (let index = 0; index < 6; index += 1) await page.put(item(`i${index}`, index));

    const until = Date.now() + 60_000;
    const taken = await Promise.all(
      Array.from({ length: 10 }, (_, index) => (index % 2 ? worker : page).claimNext(index % 2 ? "worker" : "page", Date.now(), until)),
    );
    const ids = taken.filter(Boolean).map((claimed) => claimed!.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(await page.claimNext("page", Date.now(), until)).toBeNull();
  });
});

describe("the page's store", () => {
  it("keeps in memory what the disk has no room for, and says so", async () => {
    const disk = await freshStore();
    const full: QueueStore = Object.assign(Object.create(disk), {
      put: async (entry: QueuedUpload) => {
        if (entry.id === "huge") throw Object.assign(new Error("Quota"), { name: "QuotaExceededError" });
        return disk.put(entry);
      },
    });
    const store = new PageQueueStore(full);
    await store.put(item("small", 1));
    await store.put(item("huge", 2));
    expect(store.isVolatile("huge")).toBe(true);
    expect(store.isVolatile("small")).toBe(false);
    expect((await store.all()).map((entry) => entry.id).sort()).toEqual(["huge", "small"]);
    // The one a closed tab would lose goes first.
    expect((await store.claimNext("page", Date.now(), Date.now() + 1_000))?.id).toBe("huge");
  });

  it("works with no disk at all, for a browser that keeps nothing", async () => {
    const store = new PageQueueStore(null);
    expect(store.durable).toBe(false);
    await store.put(item("a", 1));
    expect(store.isVolatile("a")).toBe(true);
    expect((await store.get("a"))?.id).toBe("a");
  });

  it("matches the disk store's rules in memory", async () => {
    const store = new MemoryQueueStore();
    await store.put(item("b", 2));
    await store.put(item("a", 1));
    expect((await store.claimNext("me", 10, 100))?.id).toBe("a");
    expect((await store.claimNext("me", 10, 100))?.id).toBe("b");
    expect(await store.claimNext("me", 10, 100)).toBeNull();
  });
});
