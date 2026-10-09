import { describe, expect, it } from "vitest";
import { newQueuedUpload, type QueuedUpload, type SentProgress } from "./record";
import { SendFailure, sendUpload, type SendContext } from "./send";
import { TransferError, type PutFn } from "./transport";

/**
 * The upload protocol against a scripted server: what it asks, in what order,
 * and above all that it resumes from what it wrote down instead of starting
 * over, and recognises an upload that is already in.
 */

type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | "offline";
type Handler = (body: Record<string, unknown>, call: number) => Answer;

function fakeServer(handlers: Record<string, Handler>) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const counts = new Map<string, number>();
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    const call = counts.get(path) ?? 0;
    counts.set(path, call + 1);
    const handler = handlers[path];
    if (!handler) throw new Error(`No route for ${path}`);
    const answer = handler(body, call);
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: answer.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls, count: (path: string) => counts.get(path) ?? 0 };
}

function fakeStorage(fail: (url: string, attempt: number) => number | null = () => null) {
  const puts: Array<{ url: string; size: number }> = [];
  const attempts = new Map<string, number>();
  const put: PutFn = async (url, body, _type, onProgress) => {
    const attempt = attempts.get(url) ?? 0;
    attempts.set(url, attempt + 1);
    const status = fail(url, attempt);
    if (status !== null) throw new TransferError("refused", status);
    puts.push({ url, size: body.size });
    onProgress(body.size);
  };
  return { put, puts };
}

const context = { eventId: "e1", slug: "party", albumId: null, maxVideoSeconds: 60 };
const media = { id: "m1", kind: "photo" };

function photo(patch: Partial<QueuedUpload> = {}): QueuedUpload {
  return {
    ...newQueuedUpload("m1", { file: new File(["0123456789"], "p.jpg", { type: "image/jpeg" }) }, context),
    ready: true,
    thumb: new Blob(["thumb"]),
    width: 10,
    height: 10,
    clientCompressed: true,
    ...patch,
  };
}

function run(item: QueuedUpload, server: ReturnType<typeof fakeServer>, storage: ReturnType<typeof fakeStorage>, extra: Partial<SendContext> = {}) {
  const saved: Array<Partial<SentProgress>> = [];
  const progress: number[] = [];
  const promise = sendUpload(item, {
    fetch: server.fetch,
    put: storage.put,
    patienceMs: 0,
    save: async (patch) => {
      saved.push(patch);
      Object.assign(item.sent, patch);
    },
    onProgress: (fraction) => progress.push(fraction),
    ...extra,
  });
  return { promise, saved, progress };
}

const signed = {
  status: 200,
  body: {
    uploadUrl: "https://r2/put",
    multipart: null,
    pathname: "events/e1/m1.jpg",
    thumbUploadUrl: "https://r2/thumb",
    thumbPathname: "events/e1/m1.thumb.jpg",
    posterUploadUrl: null,
    posterPathname: null,
  },
};

describe("sending a photo", () => {
  it("signs, sends the thumbnail then the file, and registers", async () => {
    const server = fakeServer({
      "/api/upload": () => signed,
      "/api/e/party/media": (body) => {
        expect(body).toMatchObject({ mediaId: "m1", pathname: "events/e1/m1.jpg", thumbPathname: "events/e1/m1.thumb.jpg", sizeBytes: 10 });
        return { status: 201, body: { media } };
      },
    });
    const storage = fakeStorage();
    const { promise, progress } = run(photo(), server, storage);
    expect(await promise).toEqual({ media });
    expect(storage.puts.map((entry) => entry.url)).toEqual(["https://r2/thumb", "https://r2/put"]);
    expect(progress.at(-1)).toBe(1);
  });

  it("asks only for registration when the file went up but the answer was lost", async () => {
    const item = photo();
    let online = false;
    const server = fakeServer({
      "/api/upload": () => signed,
      "/api/e/party/media": () => (online ? { status: 200, body: { media, alreadyAdded: true } } : "offline"),
    });
    const storage = fakeStorage();
    await expect(run(item, server, storage).promise).rejects.toMatchObject({ status: 0, transient: true });
    expect(item.sent.stored).toBe(true);

    online = true;
    expect(await run(item, server, storage).promise).toEqual({ media });
    // One signature, one file sent, two registrations.
    expect(server.count("/api/upload")).toBe(1);
    expect(storage.puts.filter((entry) => entry.url === "https://r2/put")).toHaveLength(1);
    expect(server.count("/api/e/party/media")).toBe(2);
  });

  it("treats a sign refused as taken, for an upload it already has a key for, as in", async () => {
    const item = photo({ sent: { pathname: "events/e1/m1.jpg", multipart: null, posterPathname: null, thumbPathname: null, stored: false, restarted: false } });
    const server = fakeServer({
      "/api/upload": () => ({ status: 409, body: { error: "Upload identifier is already in use" } }),
      "/api/e/party/media": () => ({ status: 200, body: { media, alreadyAdded: true } }),
    });
    expect(await run(item, server, fakeStorage()).promise).toEqual({ media });
  });

  it("is done when the server says the id is someone else's, rather than retrying for ever", async () => {
    const server = fakeServer({
      "/api/upload": () => signed,
      "/api/e/party/media": () => ({ status: 409, body: { error: "Upload identifier is already in use" } }),
    });
    expect(await run(photo(), server, fakeStorage()).promise).toEqual({ media: null });
  });

  it("reuses a fresh signature after a blip, rather than spending another", async () => {
    const item = photo();
    const signatures = new Map();
    const server = fakeServer({
      "/api/upload": () => signed,
      "/api/e/party/media": () => ({ status: 201, body: { media } }),
    });
    // The file's PUT fails three times running (the quick retries included), then works.
    const storage = fakeStorage((url, attempt) => (url === "https://r2/put" && attempt < 3 ? 0 : null));
    await expect(run(item, server, storage, { signatures }).promise).rejects.toMatchObject({ status: 0 });
    expect(await run(item, server, storage, { signatures }).promise).toEqual({ media });
    expect(server.count("/api/upload")).toBe(1);
  });

  it("passes on a refusal in the server's words, and a throttle's wait", async () => {
    const full = fakeServer({ "/api/upload": () => ({ status: 413, body: { error: "This gallery is full. Ask the host to make room.", full: true } }) });
    const refusal = await run(photo(), full, fakeStorage()).promise.catch((error) => error);
    expect(refusal).toBeInstanceOf(SendFailure);
    expect(refusal).toMatchObject({ status: 413, transient: false, message: "This gallery is full. Ask the host to make room." });

    const busy = fakeServer({ "/api/upload": () => ({ status: 429, body: { error: "Too many uploads." }, headers: { "Retry-After": "120" } }) });
    expect(await run(photo(), busy, fakeStorage()).promise.catch((error) => error)).toMatchObject({ status: 429, transient: true, retryAfterMs: 120_000 });
  });

  it("starts the file once more when registration cannot find it, and only once", async () => {
    const item = photo();
    const server = fakeServer({
      "/api/upload": () => signed,
      "/api/e/party/media": () => ({ status: 400, body: { error: "Uploaded file could not be verified" } }),
    });
    const storage = fakeStorage();
    await expect(run(item, server, storage).promise).rejects.toMatchObject({ status: 400, transient: true });
    expect(item.sent).toMatchObject({ stored: false, restarted: true });
    await expect(run(item, server, storage).promise).rejects.toMatchObject({ status: 400, transient: false });
    expect(storage.puts.filter((entry) => entry.url === "https://r2/put")).toHaveLength(2);
  });

  it("stops before registering when the person removed it meanwhile", async () => {
    const server = fakeServer({ "/api/upload": () => signed, "/api/e/party/media": () => ({ status: 201, body: { media } }) });
    const error = await run(photo(), server, fakeStorage(), { stillWanted: async () => false }).promise.catch((caught) => caught);
    expect(error.name).toBe("AbortError");
    expect(server.count("/api/e/party/media")).toBe(0);
  });
});

describe("sending a large file in parts", () => {
  // Ten bytes in parts of four: 4, 4 and 2.
  const video = () => ({
    ...newQueuedUpload("m1", { file: new File(["0123456789"], "clip.mp4", { type: "video/mp4" }) }, context),
    ready: true,
    poster: new Blob(["poster"]),
  });

  it("records the upload id, so a reload resumes it", async () => {
    const item = video();
    const server = fakeServer({
      "/api/upload": () => ({
        status: 200,
        body: {
          uploadUrl: null,
          multipart: { uploadId: "u1", partSize: 4, urls: ["https://r2/p1", "https://r2/p2", "https://r2/p3"] },
          pathname: "events/e1/m1.mp4",
          posterUploadUrl: "https://r2/poster",
          posterPathname: "events/e1/m1.poster.jpg",
          thumbUploadUrl: null,
          thumbPathname: null,
        },
      }),
    });
    // Part three is refused (its signature ran out while the phone slept).
    const storage = fakeStorage((url) => (url === "https://r2/p3" ? 403 : null));
    await expect(run(item, server, storage).promise).rejects.toMatchObject({ transient: true });
    expect(item.sent).toMatchObject({ multipart: { uploadId: "u1", partSize: 4 }, posterPathname: "events/e1/m1.poster.jpg", stored: false });
  });

  it("after a reload, sends only the parts storage does not have, then joins and registers", async () => {
    const item = video();
    item.sent = { ...item.sent, pathname: "events/e1/m1.mp4", multipart: { uploadId: "u1", partSize: 4 }, posterPathname: "events/e1/m1.poster.jpg" };
    const server = fakeServer({
      "/api/upload/parts": (body) => {
        expect(body).toMatchObject({ uploadId: "u1", sizeBytes: 10 });
        // The poster already arrived, so no slot is asked for it.
        expect(body.posterBytes).toBeUndefined();
        return { status: 200, body: { partSize: 4, parts: [{ number: 3, url: "https://r2/p3b" }], arrived: [1, 2] } };
      },
      "/api/upload/complete": (body) => {
        expect(body).toMatchObject({ uploadId: "u1" });
        return { status: 200, body: { ok: true } };
      },
      "/api/e/party/media": (body) => {
        expect(body).toMatchObject({ pathname: "events/e1/m1.mp4", posterPathname: "events/e1/m1.poster.jpg" });
        return { status: 201, body: { media } };
      },
    });
    const storage = fakeStorage();
    const { promise, progress } = run(item, server, storage);
    expect(await promise).toEqual({ media });
    expect(server.count("/api/upload")).toBe(0);
    expect(storage.puts).toEqual([{ url: "https://r2/p3b", size: 2 }]);
    // Starts at the eight bytes already there.
    expect(progress[0]).toBeCloseTo(0.8);
  });

  it("starts the file again when storage no longer has the upload", async () => {
    const item = video();
    item.sent = { ...item.sent, pathname: "events/e1/m1.mp4", multipart: { uploadId: "gone", partSize: 4 } };
    const server = fakeServer({
      "/api/upload/parts": () => ({ status: 404, body: { error: "That upload has expired. It will start again." } }),
      "/api/upload": () => ({
        status: 200,
        body: {
          uploadUrl: null,
          multipart: { uploadId: "u2", partSize: 4, urls: ["https://r2/a", "https://r2/b", "https://r2/c"] },
          pathname: "events/e1/m1.mp4",
          posterUploadUrl: null,
          posterPathname: null,
          thumbUploadUrl: null,
          thumbPathname: null,
        },
      }),
      "/api/upload/complete": (body) => {
        expect(body.uploadId).toBe("u2");
        return { status: 200, body: { ok: true } };
      },
      "/api/e/party/media": () => ({ status: 201, body: { media } }),
    });
    const storage = fakeStorage();
    expect(await run(item, server, storage).promise).toEqual({ media });
    expect(storage.puts.map((entry) => entry.url)).toEqual(["https://r2/a", "https://r2/b", "https://r2/c"]);
  });

  it("forgets the upload when joining fails, since the server gives its parts up", async () => {
    const item = video();
    item.sent = { ...item.sent, pathname: "events/e1/m1.mp4", multipart: { uploadId: "u1", partSize: 4 } };
    const server = fakeServer({
      "/api/upload/parts": () => ({ status: 200, body: { partSize: 4, parts: [], arrived: [1, 2, 3] } }),
      "/api/upload/complete": () => ({ status: 400, body: { error: "Part of the file did not arrive. Try again." } }),
    });
    await expect(run(item, server, fakeStorage()).promise).rejects.toMatchObject({ transient: true });
    expect(item.sent.multipart).toBeNull();
  });
});
