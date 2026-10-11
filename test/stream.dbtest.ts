import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify } from "jose";

let viewer: {
  access: { allowed: boolean };
  guestId: string | null;
  kioskId: null;
  kioskAlbumId: null;
  ownerSession: { user: { id: string } } | null;
};

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));
vi.mock("@/lib/media-urls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media-urls")>()),
  signObjectUrl: async (key: string) => `https://r2.test/${key}?signed`,
}));

const { transcodeVideo, backfillTranscodes, reapStreamCopies } = await import("@/lib/job-handlers/transcode");
const { GET: content } = await import("@/app/api/e/[slug]/media/[mediaId]/content/route");
const { jobs, media, providerSecrets, streamDeletions } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, maxAttempts: 5, deadline: Date.now() + 60_000 };
const UID = "0123456789abcdef0123456789abcdef";

/** A real RSA key, as Stream's /keys would hand one over. */
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: "key_1", alg: "RS256" };

let videoState: { readyToStream: boolean; state: string } = { readyToStream: false, state: "inprogress" };
const calls: Array<{ method: string; path: string; body: unknown }> = [];
let deleteStatus = 200;

function stream(url: string, init?: RequestInit): Response {
  const path = url.replace(/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/stream/, "");
  const method = init?.method ?? "GET";
  calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (path === "/keys" && method === "POST") {
    return Response.json({ success: true, result: { id: "key_1", jwk: Buffer.from(JSON.stringify(jwk)).toString("base64"), pem: "x" } });
  }
  if (path === "/copy") return Response.json({ success: true, result: { uid: UID, readyToStream: false, status: { state: "queued" } } });
  if (path === `/${UID}` && method === "GET") {
    return Response.json({
      success: true,
      result: {
        uid: UID,
        readyToStream: videoState.readyToStream,
        status: { state: videoState.state },
        playback: { hls: `https://customer-abc123.cloudflarestream.com/${UID}/manifest/video.m3u8` },
      },
    });
  }
  if (method === "DELETE") return Response.json({ success: deleteStatus === 200, errors: [] }, { status: deleteStatus });
  return Response.json({ success: false, errors: [{ message: "unexpected" }] }, { status: 400 });
}

beforeEach(async () => {
  calls.length = 0;
  videoState = { readyToStream: false, state: "inprogress" };
  deleteStatus = 200;
  process.env.CLOUDFLARE_STREAM_API_TOKEN = "stream-token";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => stream(String(input), init)));
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
});
afterAll(closeDatabase);

async function clip(eventId: string, overrides: Parameters<typeof makeMedia>[1] = {}) {
  return makeMedia(eventId, { kind: "video", mimeType: "video/mp4", metadataState: "clean", ...overrides });
}
const row = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

describe("media.transcode", () => {
  it("copies a cleaned video into Stream with signed playback only, then marks it ready", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await clip(eventId);
    expect(await transcodeVideo({ mediaId: id }, context)).toEqual({ requeue: { delayMs: 15_000 } });
    const copy = calls.find((call) => call.path === "/copy")!;
    expect(copy.body).toMatchObject({
      url: `https://r2.test/events/${eventId}/${id}.jpg?signed`,
      requireSignedURLs: true,
      meta: { name: id, eventId },
    });
    // No webhook outside production.
    expect(calls.some((call) => call.path === "/webhook")).toBe(false);
    expect(await row(id)).toMatchObject({ streamUid: UID, streamState: "pending" });

    expect(await transcodeVideo({ mediaId: id }, context)).toEqual({ requeue: { delayMs: 15_000 } });
    videoState = { readyToStream: true, state: "ready" };
    expect(await transcodeVideo({ mediaId: id }, context)).toBeUndefined();
    expect((await row(id)).streamState).toBe("ready");
    // The playback host is remembered, sealed, for signing.
    expect(await testDb.select().from(providerSecrets)).toHaveLength(1);
  });

  it("waits for the location scrub, skips photos and does nothing without a key", async () => {
    const eventId = await makeEvent(await makeUser());
    const scrubbing = await clip(eventId, { metadataState: "pending" });
    const photo = await makeMedia(eventId);
    await transcodeVideo({ mediaId: scrubbing }, context);
    await transcodeVideo({ mediaId: photo }, context);
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
    const later = await clip(eventId);
    await transcodeVideo({ mediaId: later }, context);
    expect(calls).toHaveLength(0);
  });

  it("gives up on a copy Stream could not encode, so the original keeps playing", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await clip(eventId);
    await transcodeVideo({ mediaId: id }, context);
    videoState = { readyToStream: false, state: "error" };
    await transcodeVideo({ mediaId: id }, context);
    expect((await row(id)).streamState).toBe("failed");
  });

  it("is backfilled newest first, never while a scrub is pending, and not at all without a key", async () => {
    const eventId = await makeEvent(await makeUser());
    const older = await clip(eventId, { createdAt: new Date("2026-01-01") });
    const newer = await clip(eventId, { createdAt: new Date("2026-06-01") });
    await clip(eventId, { metadataState: "pending" });
    await clip(eventId, { streamUid: UID, streamState: "ready" });
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
    await backfillTranscodes({}, context);
    expect(await testDb.select().from(jobs)).toHaveLength(0);
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "stream-token";
    await backfillTranscodes({}, context);
    const queued = (await testDb.select().from(jobs)).map((job) => (job.payload as { mediaId: string }).mediaId);
    expect(queued).toEqual([newer, older]);
  });
});

describe("playback", () => {
  it("redirects to a manifest behind a token Klik signed, after the access check", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const id = await clip(eventId);
    await transcodeVideo({ mediaId: id }, context);
    videoState = { readyToStream: true, state: "ready" };
    await transcodeVideo({ mediaId: id }, context);

    viewer = { access: { allowed: true }, guestId: null, kioskId: null, kioskAlbumId: null, ownerSession: { user: { id: owner } } };
    const params = { params: Promise.resolve({ slug: `${eventId}-slug`, mediaId: id }) };
    const response = await content(new Request(`http://localhost/api/e/x/media/${id}/content?hls=1`), params);
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    const match = /^https:\/\/customer-abc123\.cloudflarestream\.com\/([^/]+)\/manifest\/video\.m3u8$/.exec(location);
    expect(match).not.toBeNull();
    const token = match![1];
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: "key_1" });
    const claims = decodeJwt(token);
    expect(claims.sub).toBe(UID);
    expect(claims.exp! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60 * 60);
    await expect(jwtVerify(token, publicKey)).resolves.toBeTruthy();
    // The key was made once, at Stream, and kept sealed.
    expect(calls.filter((call) => call.path === "/keys")).toHaveLength(1);

    // A guest who may not see it gets nothing, Stream copy or not.
    viewer = { access: { allowed: true }, guestId: "someone", kioskId: null, kioskAlbumId: null, ownerSession: null };
    await testDb.update(media).set({ visibility: "private" }).where(eq(media.id, id));
    expect((await content(new Request(`http://localhost/x?hls=1`), params)).status).toBe(404);
  });

  it("answers 404 for a video with no ready copy, so the player falls back to the original", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const id = await clip(eventId);
    viewer = { access: { allowed: true }, guestId: null, kioskId: null, kioskAlbumId: null, ownerSession: { user: { id: owner } } };
    const params = { params: Promise.resolve({ slug: `${eventId}-slug`, mediaId: id }) };
    expect((await content(new Request(`http://localhost/x?hls=1`), params)).status).toBe(404);
  });
});

describe("deleting a video deletes its Stream copy", () => {
  it("queues the copy in the database on any hard delete, and the reaper empties the queue", async () => {
    const eventId = await makeEvent(await makeUser());
    const gone = await clip(eventId, { streamUid: UID, streamState: "ready" });
    const kept = await clip(eventId, { streamUid: "f".repeat(32), streamState: "ready" });
    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, kept));
    await testDb.delete(media).where(eq(media.id, gone));
    expect((await testDb.select().from(streamDeletions)).map((row) => row.uid)).toEqual([UID]);

    await reapStreamCopies({}, context);
    expect(calls).toContainEqual({ method: "DELETE", path: `/${UID}`, body: null });
    expect(await testDb.select().from(streamDeletions)).toHaveLength(0);
  });

  it("counts a copy already gone at Stream as done, and keeps one that failed for tomorrow", async () => {
    const eventId = await makeEvent(await makeUser());
    await testDb.insert(streamDeletions).values({ uid: UID });
    deleteStatus = 404;
    await reapStreamCopies({}, context);
    expect(await testDb.select().from(streamDeletions)).toHaveLength(0);

    await testDb.insert(streamDeletions).values({ uid: UID });
    deleteStatus = 500;
    await reapStreamCopies({}, { ...context, attempt: 5 });
    const [left] = await testDb.select().from(streamDeletions);
    expect(left.attempts).toBe(1);
    void eventId;
  });

  it("follows an event's cascade too", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    await clip(eventId, { streamUid: UID, streamState: "ready" });
    const { events } = await import("@/lib/schema");
    await testDb.delete(events).where(eq(events.id, eventId));
    expect((await testDb.select().from(streamDeletions)).map((row) => row.uid)).toEqual([UID]);
  });
});
