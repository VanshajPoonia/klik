import { nanoid } from "nanoid";
import { drainQueue } from "./drain";
import { prepareUpload } from "./prepare";
import {
  QUEUE_MAX_AGE_MS,
  QUEUE_TAG,
  QUEUE_WORKER_SCOPE,
  QUEUE_WORKER_URL,
  newQueuedUpload,
  type NewUpload,
  type QueuedUpload,
} from "./record";
import { IdbQueueStore, PageQueueStore, openQueueDatabase, type QueueStore } from "./store";
import { xhrPut } from "./transport";

/**
 * OPS-3: the upload queue as a page sees it. One per page, shared by whatever
 * on it uploads.
 *
 * A picked file is written to the device first and sent from there, so
 * nothing a guest picks is lost to a dropped connection, a locked phone or a
 * closed tab. The page prepares each file (compression, stills), sends three
 * at a time, waits out a lost connection, and tells the tray what is going on.
 *
 * Where the browser has Background Sync (Chrome on Android), a small service
 * worker takes over when the page goes into the background, so the queue
 * keeps draining with the tab closed. Elsewhere, iPhones included, it picks
 * up where it stopped the next time the gallery is opened.
 */

export type TrayStatus = "preparing" | "waiting" | "sending" | "refused";

export interface TrayItem {
  id: string;
  eventId: string;
  name: string;
  kind: "photo" | "video";
  status: TrayStatus;
  /** 0 to 1, while sending. */
  progress: number | null;
  /** Why it was refused, in the server's words. */
  message: string | null;
  /** TRS-3: the same, as a code the tray can say in the guest's language. */
  code: string | null;
  values: Record<string, number | string> | null;
  status401: boolean;
  /** Kept only in this page: closing it before this sends loses it. */
  volatile: boolean;
  /** An object URL for a small preview, when there is one. */
  preview: string | null;
  addedAt: number;
  /** When a waiting item is next tried, if it is backing off. */
  retryAt: number;
}

export interface QueueSnapshot {
  items: TrayItem[];
  online: boolean;
  /** False when this browser keeps nothing, so every item is `volatile`. */
  durable: boolean;
}

export interface QueueContext {
  eventId: string;
  slug: string;
  albumId: string | null;
  maxVideoSeconds: number;
  /** MED-10: send photos as watermarked proofs. */
  proof?: boolean;
}

export interface AddedEvent {
  id: string;
  eventId: string;
  /** The gallery item, when the sender had it. */
  media: unknown | null;
}

type QueueMessage =
  | { type: "changed" }
  | { type: "progress"; id: string; fraction: number }
  | { type: "added"; id: string; eventId: string; media: unknown | null };

const PAGE_CONCURRENCY = 3;
const PREPARE_CONCURRENCY = 2;
/** How long a part waits for a lost connection before the queue's own wait takes over. */
const PAGE_PATIENCE_MS = 5 * 60 * 1000;
const MAX_IDLE_MS = 60_000;
const PROGRESS_BROADCAST_MS = 300;
/** Progress heard from another sender counts as current for this long. */
const REMOTE_FRESH_MS = 15_000;

export const EMPTY_SNAPSHOT: QueueSnapshot = { items: [], online: true, durable: true };

async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("SyncManager" in window)) return null;
  try {
    const registration = await navigator.serviceWorker.register(QUEUE_WORKER_URL, {
      scope: QUEUE_WORKER_SCOPE,
      updateViaCache: "none",
    });
    if (registration.active) return registration;
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return null;
    return await new Promise((resolve) => {
      const check = () => {
        if (worker.state === "activated" || worker.state === "redundant") {
          worker.removeEventListener("statechange", check);
          resolve(worker.state === "activated" ? registration : null);
        }
      };
      worker.addEventListener("statechange", check);
      check();
    });
  } catch {
    return null;
  }
}

async function runLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await run(item);
      }
    }),
  );
}

class UploadQueue {
  private readonly by = `page:${nanoid(8)}`;
  private store: PageQueueStore | null = null;
  private opening: Promise<PageQueueStore> | null = null;
  private records: QueuedUpload[] = [];
  private readonly progress = new Map<string, number>();
  private readonly local = new Set<string>();
  private readonly remote = new Map<string, { fraction: number; at: number }>();
  private readonly preparing = new Set<string>();
  private readonly previews = new Map<string, { key: string; url: string }>();
  private readonly stops = new Map<string, AbortController>();
  private readonly signatures = new Map();
  private readonly listeners = new Set<() => void>();
  private readonly addedListeners = new Set<(event: AddedEvent) => void>();
  private readonly lastBroadcast = new Map<string, number>();
  private snapshot: QueueSnapshot = EMPTY_SNAPSHOT;
  private channel: BroadcastChannel | null = null;
  private wakers: Array<() => void> = [];
  private worker: Promise<ServiceWorkerRegistration | null> = Promise.resolve(null);
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Opens the queue and starts sending whatever is waiting. Safe to call often. */
  start(): Promise<PageQueueStore> {
    if (!this.opening) this.opening = this.open();
    return this.opening;
  }

  private async open(): Promise<PageQueueStore> {
    let disk: QueueStore | null = null;
    try {
      disk = new IdbQueueStore(await openQueueDatabase());
    } catch {
      disk = null;
    }
    const store = new PageQueueStore(disk);
    this.store = store;

    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(QUEUE_TAG);
      this.channel.onmessage = (event: MessageEvent<QueueMessage>) => this.onMessage(event.data);
    }

    const now = Date.now();
    for (const item of await store.all()) {
      if (now - item.addedAt > QUEUE_MAX_AGE_MS) {
        await store.remove(item.id).catch(() => {});
      } else if (item.refused?.status === 401) {
        // Refused for want of a session: a freshly opened page may well have
        // one (a guest who joined again, a kiosk paired again), so it gets
        // another go. Done before the tray first looks, so a kiosk does not
        // read an old refusal as being switched off now.
        await store.update(item.id, () => ({ refused: null, serverFailures: 0, tries: 0, retryAt: 0 })).catch(() => null);
      }
    }
    await this.refresh();
    this.prepareWaiting();
    void this.drain();
    this.worker = registerWorker();
    return store;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Every upload that lands, from this page or any other sender on this device. */
  onAdded(listener: (event: AddedEvent) => void): () => void {
    this.addedListeners.add(listener);
    return () => {
      this.addedListeners.delete(listener);
    };
  }

  /** Keeps the files on this device and starts sending them. Resolves to their media ids. */
  async enqueue(context: QueueContext, uploads: NewUpload[]): Promise<string[]> {
    const store = await this.start();
    const now = Date.now();
    const ids: string[] = [];
    for (const [index, upload] of uploads.entries()) {
      // Kept in the order picked, even when several share a millisecond.
      const item = newQueuedUpload(nanoid(), upload, context, now + index);
      await store.put(item);
      ids.push(item.id);
    }
    await this.changed();
    this.prepareWaiting();
    if (!this.isOnline()) void this.requestBackgroundSync();
    return ids;
  }

  /** Sends a refused item once more, or one backing off, now. */
  async retry(id: string): Promise<void> {
    const store = await this.start();
    await store.update(id, () => ({ refused: null, serverFailures: 0, tries: 0, retryAt: 0 }));
    await this.changed();
    this.wake();
  }

  /** Everything backing off goes again now, as if the connection had just come back. */
  async retryNow(): Promise<void> {
    const store = await this.start();
    for (const item of this.records) {
      if (!item.refused && item.retryAt > Date.now()) await store.update(item.id, () => ({ retryAt: 0 }));
    }
    await this.changed();
    this.wake();
  }

  async remove(id: string): Promise<void> {
    const store = await this.start();
    this.stops.get(id)?.abort();
    await store.remove(id);
    await this.changed();
  }

  /** Every item for an event, gone: its guest left, or the kiosk was switched off. */
  async clearEvent(eventId: string): Promise<void> {
    const store = await this.start();
    for (const item of this.records.filter((record) => record.eventId === eventId)) {
      this.stops.get(item.id)?.abort();
      await store.remove(item.id).catch(() => {});
    }
    await this.changed();
  }

  private isOnline() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  private onOnline = () => {
    void this.retryNow();
  };

  private onOffline = () => {
    this.emit();
    void this.requestBackgroundSync();
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") {
      // Going into the background, maybe for good: hand over to the worker.
      void this.requestBackgroundSync();
    } else {
      void this.refresh();
      this.prepareWaiting();
      this.wake();
    }
  };

  private onMessage(message: QueueMessage) {
    if (message.type === "progress") {
      this.remote.set(message.id, { fraction: message.fraction, at: Date.now() });
      this.emitSoon();
      return;
    }
    if (message.type === "added") {
      this.remote.delete(message.id);
      this.announce({ id: message.id, eventId: message.eventId, media: message.media });
    }
    void this.refresh();
    this.prepareWaiting();
    this.wake();
  }

  private broadcast(message: QueueMessage) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel: other tabs reload from the store when they look.
    }
  }

  private announce(event: AddedEvent) {
    for (const listener of this.addedListeners) listener(event);
  }

  private async changed() {
    await this.refresh();
    this.broadcast({ type: "changed" });
  }

  private async requestBackgroundSync() {
    if (!this.records.some((item) => item.ready && !item.refused)) return;
    const registration = (await this.worker) as (ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }) | null;
    await registration?.sync?.register(QUEUE_TAG).catch(() => {});
  }

  private prepareWaiting() {
    const store = this.store;
    if (!store) return;
    const waiting = this.records
      .filter((item) => !item.ready && !item.refused && !this.preparing.has(item.id))
      .sort((a, b) => a.addedAt - b.addedAt);
    if (waiting.length === 0) return;
    for (const item of waiting) this.preparing.add(item.id);
    this.emit();
    void runLimited(waiting, PREPARE_CONCURRENCY, async (item) => {
      try {
        const patch = await prepareUpload(item);
        await store.update(item.id, () => patch);
      } catch {
        // Send it as picked: the server compresses what the browser could not.
        await store.update(item.id, () => ({ ready: true })).catch(() => null);
      } finally {
        this.preparing.delete(item.id);
        await this.changed();
        this.wake();
      }
    });
  }

  private async drain() {
    const store = this.store!;
    await drainQueue({
      store,
      by: this.by,
      concurrency: PAGE_CONCURRENCY,
      fetch: (input, init) => fetch(input, init),
      put: xhrPut,
      patienceMs: PAGE_PATIENCE_MS,
      once: false,
      online: () => this.isOnline(),
      wait: (until) => this.sleep(until),
      stops: this.stops,
      signatures: this.signatures,
      events: {
        started: (item) => {
          this.local.add(item.id);
          this.progress.set(item.id, 0);
          void this.changed();
        },
        progress: (id, fraction) => {
          this.progress.set(id, fraction);
          this.emitSoon();
          const last = this.lastBroadcast.get(id) ?? 0;
          if (Date.now() - last > PROGRESS_BROADCAST_MS) {
            this.lastBroadcast.set(id, Date.now());
            this.broadcast({ type: "progress", id, fraction });
          }
        },
        finished: (item, media) => {
          this.local.delete(item.id);
          this.progress.delete(item.id);
          this.lastBroadcast.delete(item.id);
          this.announce({ id: item.id, eventId: item.eventId, media });
          this.broadcast({ type: "added", id: item.id, eventId: item.eventId, media });
          void this.refresh();
        },
        failed: (item) => {
          this.local.delete(item.id);
          this.progress.delete(item.id);
          void this.changed();
          if (!item.refused && !this.isOnline()) void this.requestBackgroundSync();
        },
      },
    });
  }

  private sleep(until: number | null): Promise<void> {
    return new Promise((resolve) => {
      const delay = until === null ? MAX_IDLE_MS : Math.min(MAX_IDLE_MS, Math.max(50, until - Date.now()));
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, delay);
      this.wakers.push(finish);
    });
  }

  private wake() {
    const wakers = this.wakers;
    this.wakers = [];
    for (const wake of wakers) wake();
  }

  private async refresh() {
    if (!this.store) return;
    this.records = await this.store.all().catch(() => this.records);
    this.emit();
  }

  private emitSoon() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, 100);
  }

  private previewFor(item: QueuedUpload): string | null {
    const source = item.thumb ? { key: "thumb", blob: item.thumb } : item.kind === "photo" ? { key: "file", blob: item.file } : null;
    const held = this.previews.get(item.id);
    if (!source) return null;
    if (held?.key === source.key) return held.url;
    if (held) URL.revokeObjectURL(held.url);
    const url = URL.createObjectURL(source.blob);
    this.previews.set(item.id, { key: source.key, url });
    return url;
  }

  private emit() {
    const now = Date.now();
    const present = new Set(this.records.map((item) => item.id));
    for (const [id, held] of this.previews) {
      if (!present.has(id)) {
        URL.revokeObjectURL(held.url);
        this.previews.delete(id);
      }
    }
    const items = [...this.records]
      .sort((a, b) => a.addedAt - b.addedAt)
      .map((item): TrayItem => {
        const remote = this.remote.get(item.id);
        const heldElsewhere = Boolean(item.claim && item.claim.by !== this.by && item.claim.until > now);
        const sendingHere = this.local.has(item.id);
        let status: TrayStatus;
        if (item.refused) status = "refused";
        else if (!item.ready || this.preparing.has(item.id)) status = "preparing";
        else if (sendingHere || heldElsewhere) status = "sending";
        else status = "waiting";
        const progress = sendingHere
          ? (this.progress.get(item.id) ?? 0)
          : heldElsewhere && remote && now - remote.at < REMOTE_FRESH_MS
            ? remote.fraction
            : null;
        return {
          id: item.id,
          eventId: item.eventId,
          name: item.name,
          kind: item.kind,
          status,
          progress,
          message: item.refused?.message ?? null,
          code: item.refused?.code ?? null,
          values: item.refused?.values ?? null,
          status401: item.refused?.status === 401,
          volatile: this.store?.isVolatile(item.id) ?? false,
          preview: this.previewFor(item),
          addedAt: item.addedAt,
          retryAt: item.retryAt,
        };
      });
    this.snapshot = { items, online: this.isOnline(), durable: this.store?.durable ?? true };
    for (const listener of this.listeners) listener();
  }
}

let queue: UploadQueue | null = null;

/** The page's one queue. Browser only. */
export function uploadQueue(): UploadQueue {
  queue ??= new UploadQueue();
  return queue;
}

export type { UploadQueue };
