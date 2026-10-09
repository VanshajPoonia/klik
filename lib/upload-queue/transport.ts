/**
 * Moving bytes to presigned URLs, for the page and the service worker alike.
 *
 * The page sends with XMLHttpRequest, the only browser API that reports upload
 * progress. A service worker has no XMLHttpRequest, so it sends with fetch and
 * reports a part as it lands. Either way a failure carries its HTTP status, 0
 * for a lost connection, which is what decides whether to try again.
 */

export class TransferError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type PutFn = (
  url: string,
  body: Blob,
  contentType: string | null,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
) => Promise<void>;

function abortError(): Error {
  return Object.assign(new Error("Stopped"), { name: "AbortError" });
}

export function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

export const xhrPut: PutFn = (url, body, contentType, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status < 300) {
        onProgress(body.size);
        resolve();
      } else reject(new TransferError(`Upload failed: ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new TransferError("Network error", 0));
    };
    xhr.onabort = () => reject(abortError());
    xhr.send(body);
  });

export const fetchPut: PutFn = async (url, body, contentType, onProgress, signal) => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      body,
      headers: contentType ? { "Content-Type": contentType } : undefined,
      signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new TransferError("Network error", 0);
  }
  if (!response.ok) throw new TransferError(`Upload failed: ${response.status}`, response.status);
  onProgress(body.size);
};

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Resolves when the device says it is online again, or rejects after `patienceMs`. */
export function waitForOnline(patienceMs: number, signal?: AbortSignal): Promise<void> {
  if (isOnline()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      globalThis.removeEventListener?.("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onOnline = () => finish();
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new TransferError("Still offline", 0)), patienceMs);
    globalThis.addEventListener?.("online", onOnline);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const QUICK_RETRIES_MS = [600, 1_800];

/**
 * One PUT, tried again twice straight away for a blip. The URL is signed for a
 * fixed key, so sending it again only ever replaces the same object. A longer
 * outage is the queue's business: it waits, then signs afresh.
 */
export async function putWithRetry(
  put: PutFn,
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await put(url, body, contentType, onProgress, signal);
      return;
    } catch (error) {
      if (isAbort(error)) throw error;
      const status = (error as { status?: number }).status ?? 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt >= QUICK_RETRIES_MS.length) throw error;
      onProgress(0);
      await sleep(QUICK_RETRIES_MS[attempt], signal);
    }
  }
}

const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 6;
const PART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * OPS-2: the parts of a large file, three at a time, each retried on its own,
 * so a wifi drop costs one 8 MB part and not the whole video. While the device
 * says it is offline a part waits up to `patienceMs` for the connection rather
 * than spending its attempts on a network that is not there.
 *
 * `parts` are only the ones still to send: after a reload the server says
 * which have already arrived (OPS-3), and `onProgress` counts these alone.
 */
export async function sendParts(
  file: Blob,
  {
    parts,
    partSize,
    put,
    onProgress,
    patienceMs,
    signal,
  }: {
    parts: Array<{ number: number; url: string }>;
    partSize: number;
    put: PutFn;
    onProgress: (loaded: number) => void;
    patienceMs: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const loaded = new Map<number, number>();
  const report = () => onProgress([...loaded.values()].reduce((sum, value) => sum + value, 0));
  let next = 0;

  async function sendOne(part: { number: number; url: string }) {
    const start = (part.number - 1) * partSize;
    const body = file.slice(start, Math.min(file.size, start + partSize));
    for (let attempt = 0; ; attempt += 1) {
      try {
        await waitForOnline(patienceMs, signal);
        await put(part.url, body, null, (bytes) => {
          loaded.set(part.number, bytes);
          report();
        }, signal);
        loaded.set(part.number, body.size);
        report();
        return;
      } catch (error) {
        if (isAbort(error)) throw error;
        loaded.set(part.number, 0);
        report();
        const status = (error as { status?: number }).status ?? 0;
        // A 4xx other than a timeout or a throttle will not change on retry:
        // the URL expired, or the part is not what was signed.
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt >= PART_ATTEMPTS - 1) throw error;
        await sleep(PART_BACKOFF_MS[Math.min(attempt, PART_BACKOFF_MS.length - 1)], signal);
      }
    }
  }

  // One part failing for good ends the file: the others stop taking new parts.
  let failed = false;
  async function worker() {
    while (next < parts.length && !failed) {
      const part = parts[next];
      next += 1;
      try {
        await sendOne(part);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker));
}
