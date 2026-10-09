import {
  CLAIM_MS,
  CLAIM_RENEW_MS,
  MAX_SERVER_FAILURES,
  backoffMs,
  nextWakeAt,
  type QueuedUpload,
} from "./record";
import { SendFailure, sendUpload, type SendContext } from "./send";
import type { QueueStore } from "./store";
import { isAbort, type PutFn } from "./transport";

/**
 * OPS-3: sends what is in the queue, a few at a time, oldest first.
 *
 * Each item is taken with a hold that lapses unless renewed, so a page frozen
 * mid-upload, or a worker the browser stopped, lets go by itself and another
 * sender picks the item up from the progress it saved. Two senders can run at
 * once (the page and the service worker) without either sending an item the
 * other has.
 *
 * Failures sort themselves three ways. A lost connection waits for the
 * connection and is never counted against the item. A server error or a
 * throttle backs off and tries again, and after six server errors in a row
 * stops and asks the person. A refusal (the gallery is full, uploads closed,
 * the file is not a photo) stops at once and says why.
 */

export interface DrainEvents {
  started?(item: QueuedUpload): void;
  progress?(id: string, fraction: number): void;
  /** Registered and gone from the queue. `media` is the gallery item, if the server sent it. */
  finished?(item: QueuedUpload, media: unknown | null): void;
  /** Back in the queue to try later, or refused: either way, changed. */
  failed?(item: QueuedUpload): void;
}

export interface DrainOptions {
  store: QueueStore;
  /** Who is sending, so a hold can be told apart from another sender's. */
  by: string;
  concurrency: number;
  fetch: typeof fetch;
  put: PutFn;
  patienceMs: number;
  /** True for the service worker: send what can go now, then stop. */
  once: boolean;
  online(): boolean;
  /** Resolves when there may be something new to send. Not used when `once`. */
  wait?(until: number | null): Promise<void>;
  /** When `once`: take nothing new after this time. */
  deadline?: number;
  signal?: AbortSignal;
  events?: DrainEvents;
  /** Each item's own stop, so removing one mid-send stops its transfer. */
  stops?: Map<string, AbortController>;
  signatures?: SendContext["signatures"];
  now?: () => number;
}

export interface DrainSummary {
  sent: number;
  /** Ready to send and not refused, but not sent by this drain. */
  remaining: number;
}

export async function drainQueue(options: DrainOptions): Promise<DrainSummary> {
  const { store, by, events = {} } = options;
  const now = options.now ?? Date.now;
  let sent = 0;

  async function sendOne(item: QueuedUpload) {
    const stop = new AbortController();
    const onOuterAbort = () => stop.abort();
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });
    options.stops?.set(item.id, stop);
    const renew = setInterval(() => {
      void store.update(item.id, () => ({ claim: { by, until: now() + CLAIM_MS } })).catch(() => {});
    }, CLAIM_RENEW_MS);
    events.started?.(item);
    try {
      const result = await sendUpload(item, {
        fetch: options.fetch,
        put: options.put,
        patienceMs: options.patienceMs,
        signal: stop.signal,
        signatures: options.signatures,
        now,
        save: async (patch) => {
          const updated = await store.update(item.id, (current) => ({ sent: { ...current.sent, ...patch } }));
          // Removed by the person while it was going: stop here.
          if (!updated) throw Object.assign(new Error("Removed"), { name: "AbortError" });
        },
        stillWanted: async () => Boolean(await store.get(item.id)),
        onProgress: (fraction) => events.progress?.(item.id, Math.max(0, Math.min(1, fraction))),
      });
      await store.remove(item.id);
      sent += 1;
      events.finished?.(item, result.media);
    } catch (error) {
      if (isAbort(error)) {
        // Removed by the person, or the page is going: let go of it either way.
        const current = await store.update(item.id, () => ({ claim: null })).catch(() => null);
        if (current) events.failed?.(current);
        return;
      }
      const failure =
        error instanceof SendFailure ? error : new SendFailure(error instanceof Error ? error.message : "It did not send", 0);
      const updated = await store
        .update(item.id, (current) => {
          // A lost connection is the venue's wifi, not this file, and a
          // throttle is the server asking for patience. Neither counts.
          const counted = failure.status !== 0 && failure.status !== 429;
          const serverFailures = current.serverFailures + (counted ? 1 : 0);
          if (!failure.transient || serverFailures >= MAX_SERVER_FAILURES) {
            return { claim: null, serverFailures, refused: { message: failure.message, status: failure.status } };
          }
          // Offline: no point counting down, the drain waits for `online`.
          const delay =
            failure.status === 0 && !options.online() ? 0 : (failure.retryAfterMs ?? backoffMs(current.tries));
          return { claim: null, serverFailures, retryAt: now() + delay, tries: current.tries + 1 };
        })
        .catch(() => null);
      if (updated) events.failed?.(updated);
    } finally {
      clearInterval(renew);
      options.signal?.removeEventListener("abort", onOuterAbort);
      if (options.stops?.get(item.id) === stop) options.stops.delete(item.id);
    }
  }

  async function worker() {
    while (!options.signal?.aborted) {
      if (options.once && options.deadline && now() > options.deadline) return;
      if (!options.online()) {
        if (options.once) return;
        await options.wait?.(null);
        continue;
      }
      const item = await store.claimNext(by, now(), now() + CLAIM_MS).catch(() => null);
      if (!item) {
        if (options.once) return;
        await options.wait?.(nextWakeAt(await store.all().catch(() => []), now()));
        continue;
      }
      await sendOne(item);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  const left = await store.all().catch(() => []);
  return { sent, remaining: left.filter((item) => item.ready && !item.refused).length };
}
