import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { drainQueue, type DrainOptions } from "./drain";
import { MAX_SERVER_FAILURES, newQueuedUpload, type QueuedUpload } from "./record";
import { IdbQueueStore, MemoryQueueStore, openQueueDatabase, type QueueStore } from "./store";
import type { PutFn } from "./transport";

const context = { eventId: "e1", slug: "party", albumId: null, maxVideoSeconds: 60 };

function photo(id: string, addedAt: number): QueuedUpload {
  return {
    ...newQueuedUpload(id, { file: new File([`photo ${id}`], `${id}.jpg`, { type: "image/jpeg" }) }, context, addedAt),
    ready: true,
    clientCompressed: true,
  };
}

/** A gallery server: signs anything, and registers what `register` allows. */
function gallery(register: (mediaId: string, call: number) => number | "offline" = () => 201) {
  const registered: string[] = [];
  const calls = new Map<string, number>();
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (path === "/api/upload") {
      return Response.json({ uploadUrl: `https://r2/${body.mediaId}`, multipart: null, pathname: `events/e1/${body.mediaId}.jpg` });
    }
    const call = calls.get(body.mediaId) ?? 0;
    calls.set(body.mediaId, call + 1);
    const status = register(body.mediaId, call);
    if (status === "offline") throw new TypeError("Failed to fetch");
    if (status < 300) {
      registered.push(body.mediaId);
      return Response.json({ media: { id: body.mediaId } }, { status });
    }
    return Response.json({ error: status === 413 ? "This gallery is full." : "Something broke." }, { status });
  }) as typeof globalThis.fetch;
  return { fetch, registered };
}

function storage(delayMs = 0) {
  let inFlight = 0;
  let peak = 0;
  const put: PutFn = async (_url, body, _type, onProgress) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    inFlight -= 1;
    onProgress(body.size);
  };
  return { put, peak: () => peak };
}

function options(store: QueueStore, patch: Partial<DrainOptions> & Pick<DrainOptions, "fetch" | "put">): DrainOptions {
  return { store, by: "page", concurrency: 3, patienceMs: 0, once: true, online: () => true, ...patch };
}

describe("draining the queue", () => {
  it("sends everything, oldest first, a few at a time, and empties the queue", async () => {
    const store = new MemoryQueueStore();
    for (let index = 0; index < 7; index += 1) await store.put(photo(`p${index}`, index));
    const server = gallery();
    const bytes = storage(5);
    const finished: string[] = [];
    const summary = await drainQueue(
      options(store, { fetch: server.fetch, put: bytes.put, events: { finished: (item) => finished.push(item.id) } }),
    );
    expect(summary).toEqual({ sent: 7, remaining: 0 });
    expect(await store.all()).toEqual([]);
    expect(bytes.peak()).toBeLessThanOrEqual(3);
    // Started in order; three run at once, so they may finish slightly out of it.
    expect(new Set(finished)).toEqual(new Set(server.registered));
    expect(server.registered).toHaveLength(7);
  });

  it("never counts a lost connection against an item, and backs off", async () => {
    const store = new MemoryQueueStore();
    await store.put(photo("a", 1));
    const server = gallery(() => "offline");
    const now = 1_000_000;
    const summary = await drainQueue(options(store, { fetch: server.fetch, put: storage().put, now: () => now }));
    expect(summary.remaining).toBe(1);
    const [item] = await store.all();
    expect(item).toMatchObject({ refused: null, serverFailures: 0, tries: 1, claim: null, retryAt: now + 2_000 });
  });

  it("waits for the connection instead of counting down, when the device says it is offline", async () => {
    const store = new MemoryQueueStore();
    await store.put(photo("a", 1));
    let online = true;
    const fetch = (async () => {
      online = false;
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;
    await drainQueue(options(store, { fetch, put: storage().put, online: () => online, now: () => 50 }));
    expect((await store.all())[0]).toMatchObject({ retryAt: 50, refused: null });
  });

  it("gives up on server errors after a few, and says so", async () => {
    const store = new MemoryQueueStore();
    await store.put({ ...photo("a", 1), serverFailures: MAX_SERVER_FAILURES - 1 });
    await drainQueue(options(store, { fetch: gallery(() => 500).fetch, put: storage().put }));
    expect((await store.all())[0].refused).toEqual({ message: "Something broke.", status: 500 });
  });

  it("stops at once on a refusal, with the reason, and sends the rest", async () => {
    const store = new MemoryQueueStore();
    await store.put(photo("full", 1));
    await store.put(photo("fine", 2));
    const server = gallery((id) => (id === "full" ? 413 : 201));
    const summary = await drainQueue(options(store, { fetch: server.fetch, put: storage().put }));
    expect(summary).toEqual({ sent: 1, remaining: 0 });
    const [left] = await store.all();
    expect(left).toMatchObject({ id: "full", refused: { message: "This gallery is full.", status: 413 } });
  });

  it("sends nothing while offline when run once, as the worker does", async () => {
    const store = new MemoryQueueStore();
    await store.put(photo("a", 1));
    const server = gallery();
    expect(await drainQueue(options(store, { fetch: server.fetch, put: storage().put, online: () => false }))).toEqual({
      sent: 0,
      remaining: 1,
    });
    expect(server.registered).toEqual([]);
  });

  it("does not register what the person removed while it was sending", async () => {
    const store = new MemoryQueueStore();
    await store.put(photo("a", 1));
    const server = gallery();
    const put: PutFn = async (_url, body, _type, onProgress) => {
      await store.remove("a");
      onProgress(body.size);
    };
    await drainQueue(options(store, { fetch: server.fetch, put }));
    expect(server.registered).toEqual([]);
  });

  it("lets a page and the service worker drain one queue together without sending anything twice", async () => {
    const factory = new IDBFactory();
    const pageStore = new IdbQueueStore(await openQueueDatabase(factory));
    const workerStore = new IdbQueueStore(await openQueueDatabase(factory));
    for (let index = 0; index < 12; index += 1) await pageStore.put(photo(`p${index}`, index));
    const server = gallery();
    const [page, worker] = await Promise.all([
      drainQueue(options(pageStore, { by: "page", fetch: server.fetch, put: storage(3).put })),
      drainQueue(options(workerStore, { by: "worker", concurrency: 2, fetch: server.fetch, put: storage(3).put })),
    ]);
    expect(page.sent + worker.sent).toBe(12);
    expect(server.registered).toHaveLength(12);
    expect(new Set(server.registered).size).toBe(12);
    expect(await pageStore.all()).toEqual([]);
  });
});
