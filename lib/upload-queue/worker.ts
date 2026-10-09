import { drainQueue } from "./drain";
import { QUEUE_TAG } from "./record";
import { IdbQueueStore, openQueueDatabase } from "./store";
import { fetchPut } from "./transport";

/**
 * OPS-3: the service worker, bundled to `public/upload-sw.js` by
 * `scripts/build-upload-sw.mjs`. It does one thing: when the browser fires a
 * Background Sync, it sends what the queue holds, through the same code the
 * page uses.
 *
 * It is registered with a scope no page lives under and has no fetch handler,
 * so it controls nothing and never sits between a page and the network. Only
 * browsers with Background Sync register it (Chrome on Android, mainly);
 * everywhere else the page sends the queue itself whenever it is open.
 */

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  /** The browser will not fire this one again if it fails. */
  readonly lastChance: boolean;
}
interface WorkerScope {
  addEventListener(type: "sync", listener: (event: SyncEvent) => void): void;
  addEventListener(type: "install", listener: (event: ExtendableEvent) => void): void;
  skipWaiting(): Promise<void>;
}

const scope = globalThis as unknown as WorkerScope;

const WORKER_CONCURRENCY = 2;
/** Chrome stops a sync event after a few minutes. Take nothing new past this. */
const WORKER_BUDGET_MS = 150_000;

// Nothing to hand over between versions, so a new one takes over at once.
scope.addEventListener("install", () => {
  void scope.skipWaiting();
});

scope.addEventListener("sync", (event) => {
  if (event.tag !== QUEUE_TAG) return;
  event.waitUntil(drainInBackground(event.lastChance));
});

async function drainInBackground(lastChance: boolean): Promise<void> {
  const database = await openQueueDatabase();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(QUEUE_TAG);
  const tell = (message: unknown) => {
    try {
      channel?.postMessage(message);
    } catch {
      // No page listening is the usual case here.
    }
  };
  try {
    const summary = await drainQueue({
      store: new IdbQueueStore(database),
      by: `worker:${Math.random().toString(36).slice(2, 10)}`,
      concurrency: WORKER_CONCURRENCY,
      fetch: (input, init) => fetch(input, init),
      put: fetchPut,
      patienceMs: 0,
      once: true,
      online: () => navigator.onLine !== false,
      deadline: Date.now() + WORKER_BUDGET_MS,
      signatures: new Map(),
      events: {
        started: () => tell({ type: "changed" }),
        progress: (id, fraction) => tell({ type: "progress", id, fraction }),
        finished: (item, media) => tell({ type: "added", id: item.id, eventId: item.eventId, media }),
        failed: () => tell({ type: "changed" }),
      },
    });
    // Anything left (backing off, or held by a page sending it now) is for the
    // browser to schedule: failing the event asks it to fire again later.
    if (summary.remaining > 0 && !lastChance) throw new Error(`${summary.remaining} uploads still waiting`);
  } finally {
    channel?.close();
    database.close();
  }
}
