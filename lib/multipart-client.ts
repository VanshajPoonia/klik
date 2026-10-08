/**
 * OPS-2, browser side: sends a large file to presigned part URLs.
 *
 * Built for venue wifi, which drops for a few seconds at a time all evening.
 * Each 8 MB part is retried on its own, with backoff, and while the phone says
 * it is offline the retry waits for the connection rather than burning its
 * attempts against a network that is not there. A drop costs one part, not the
 * file.
 */

const CONCURRENCY = 3;
const ATTEMPTS = 6;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
/** How long to wait for the connection to come back before giving up. */
const OFFLINE_PATIENCE_MS = 5 * 60 * 1000;

function waitForOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("online", onOnline);
      reject(new Error("Still offline"));
    }, OFFLINE_PATIENCE_MS);
    const onOnline = () => {
      clearTimeout(timer);
      resolve();
    };
    window.addEventListener("online", onOnline, { once: true });
  });
}

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status < 300
        ? resolve()
        : reject(Object.assign(new Error(`Part failed: ${xhr.status}`), { status: xhr.status }));
    xhr.onerror = () => reject(Object.assign(new Error("Network error"), { status: 0 }));
    xhr.send(body);
  });
}

export async function uploadInParts(
  file: Blob,
  { urls, partSize, onProgress }: { urls: string[]; partSize: number; onProgress: (percent: number) => void },
): Promise<void> {
  const loaded = new Array<number>(urls.length).fill(0);
  const report = () => onProgress((loaded.reduce((sum, value) => sum + value, 0) / file.size) * 100);
  let next = 0;

  async function sendOne(index: number) {
    const body = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
    for (let attempt = 0; ; attempt += 1) {
      try {
        await waitForOnline();
        await putPart(urls[index], body, (bytes) => {
          loaded[index] = bytes;
          report();
        });
        loaded[index] = body.size;
        report();
        return;
      } catch (error) {
        loaded[index] = 0;
        const status = (error as { status?: number }).status ?? 0;
        // A 4xx other than a timeout or a throttle will not change on retry:
        // the URL expired, or the part is not what was signed.
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt >= ATTEMPTS - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]));
      }
    }
  }

  async function worker() {
    while (next < urls.length) {
      const index = next;
      next += 1;
      await sendOne(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
}
