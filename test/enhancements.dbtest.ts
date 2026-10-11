import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";

// A bucket in memory; sharp is real; Replicate is a fake `fetch`.
const bucket = new Map<string, Buffer>();
const send = vi.fn(async (command: { constructor: { name: string }; input: { Key: string; Body?: Buffer } }) => {
  const name = command.constructor.name;
  if (name === "GetObjectCommand") {
    const bytes = bucket.get(command.input.Key);
    if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
  }
  if (name === "PutObjectCommand") {
    bucket.set(command.input.Key, command.input.Body as Buffer);
    return {};
  }
  if (name === "DeleteObjectCommand") {
    bucket.delete(command.input.Key);
    return {};
  }
  throw new Error(`Unexpected ${name}`);
});

let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
// Work queued for after the response is not this test's business.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
}));
vi.mock("@/lib/media-urls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media-urls")>()),
  signObjectUrl: async (key: string) => `https://r2.test/${key}?signed`,
}));

const { requestEnhancement, runEnhancement, chooseEnhancement, enhancementAllowance, enhanceInputKey, EnhanceError } =
  await import("@/lib/enhancements");
const { POST: requestRoute } = await import("@/app/api/events/[id]/media/[mediaId]/enhance/route");
const { POST: webhook } = await import("@/app/api/webhooks/replicate/route");
const { aiEnhancements, events, jobs, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, maxAttempts: 5, deadline: Date.now() + 60_000 };

/** What the fake Replicate does next. */
let predictionStatus: "starting" | "processing" | "succeeded" | "failed" = "processing";
const created: Array<Record<string, unknown>> = [];
let output: Buffer;

function replicate(url: string, init?: RequestInit): Response {
  if (url === "https://replicate.delivery/out.png") return new Response(new Uint8Array(output), { headers: { "content-type": "image/png" } });
  if (url.endsWith("/models/nightmareai/real-esrgan")) return Response.json({ latest_version: { id: "v-latest" } });
  if (url.endsWith("/predictions") && init?.method === "POST") {
    created.push(JSON.parse(String(init.body)));
    return Response.json({ id: "pred_1", status: "starting" }, { status: 201 });
  }
  if (url.endsWith("/predictions/pred_1")) {
    return Response.json({
      id: "pred_1",
      status: predictionStatus,
      output: predictionStatus === "succeeded" ? "https://replicate.delivery/out.png" : null,
      error: predictionStatus === "failed" ? "CUDA out of memory" : null,
    });
  }
  if (url.endsWith("/predictions/pred_1/cancel")) return Response.json({ id: "pred_1", status: "canceled" });
  if (url.endsWith("/webhooks/default/secret")) return Response.json({ key: `whsec_${Buffer.from("k".repeat(32)).toString("base64")}` });
  return Response.json({ detail: "not found" }, { status: 404 });
}

async function photo(eventId: string, overrides: Parameters<typeof makeMedia>[1] = {}) {
  const id = await makeMedia(eventId, overrides);
  const [row] = await testDb.select().from(media).where(eq(media.id, id));
  bucket.set(row.blobPathname, await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#a33" } }).jpeg().toBuffer());
  return id;
}

async function premium() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, { planKey: "premium", licensedAt: new Date() });
  const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
  return { owner, eventId, event };
}

beforeEach(async () => {
  bucket.clear();
  send.mockClear();
  created.length = 0;
  predictionStatus = "processing";
  output = await sharp({ create: { width: 5760, height: 3840, channels: 3, background: "#3a3" } }).png().toBuffer();
  session = null;
  process.env.REPLICATE_API_TOKEN = "r8_test";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => replicate(String(input), init)));
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.REPLICATE_API_TOKEN;
});
afterAll(closeDatabase);

describe("asking for an enhancement", () => {
  it("is refused without a key, for a video, past the allowance, and twice at once", async () => {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId);
    const video = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });

    delete process.env.REPLICATE_API_TOKEN;
    await expect(requestEnhancement({ event, mediaId: id, userId: owner })).rejects.toMatchObject({ code: "not_configured" });
    process.env.REPLICATE_API_TOKEN = "r8_test";

    await expect(requestEnhancement({ event, mediaId: video, userId: owner })).rejects.toMatchObject({ code: "not_photo" });
    await requestEnhancement({ event, mediaId: id, userId: owner });
    await expect(requestEnhancement({ event, mediaId: id, userId: owner })).rejects.toMatchObject({ code: "running" });
    expect(await testDb.select().from(jobs).where(eq(jobs.kind, "ai.enhance"))).toHaveLength(1);
    expect(await enhancementAllowance(event)).toEqual({ used: 1, limit: 100 });

    const proof = await photo(eventId, { proofBy: owner, proofOriginalPathname: "clean.jpg" });
    await expect(requestEnhancement({ event, mediaId: proof, userId: owner })).rejects.toBeInstanceOf(EnhanceError);
  });

  it("counts only runs that did not fail against the allowance", async () => {
    const { owner, eventId, event } = await premium();
    for (let index = 0; index < 3; index += 1) {
      const id = await photo(eventId);
      await testDb.insert(aiEnhancements).values({ id: `enh_${index}`, eventId, mediaId: id, operation: "upscale", status: index === 0 ? "failed" : "succeeded" });
    }
    expect((await enhancementAllowance(event)).used).toBe(2);
    void owner;
  });

  it("goes through the route for a moderator only, and records it for the team", async () => {
    const { owner, eventId } = await premium();
    const id = await photo(eventId);
    const params = { params: Promise.resolve({ id: eventId, mediaId: id }) };
    expect((await requestRoute(new Request("http://localhost/x", { method: "POST" }), params)).status).toBe(401);
    session = { user: { id: owner, role: "organizer" } };
    const response = await requestRoute(new Request("http://localhost/x", { method: "POST" }), params);
    expect(response.status).toBe(202);
    expect(((await response.json()) as { allowance: { used: number } }).allowance.used).toBe(1);
  });
});

describe("the run", () => {
  it("sends a 1440px rendition, waits, and stores a hidden 4096px copy beside the original", async () => {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId, { capturedAt: "2026-06-14 18:30:00" });
    const row = await requestEnhancement({ event, mediaId: id, userId: owner });

    expect(await runEnhancement({ enhancementId: row.id }, context)).toEqual({ requeue: { delayMs: 8_000 } });
    const input = bucket.get(enhanceInputKey(eventId, id))!;
    const meta = await sharp(input).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1440);
    expect(created[0]).toMatchObject({
      version: "v-latest",
      input: { image: `https://r2.test/${enhanceInputKey(eventId, id)}?signed`, scale: 4, face_enhance: false },
    });
    // No webhook outside production.
    expect(created[0].webhook).toBeUndefined();

    // Still going: look again later.
    expect(await runEnhancement({ enhancementId: row.id }, context)).toEqual({ requeue: { delayMs: 8_000 } });

    predictionStatus = "succeeded";
    expect(await runEnhancement({ enhancementId: row.id }, context)).toBeUndefined();
    const [done] = await testDb.select().from(aiEnhancements).where(eq(aiEnhancements.id, row.id));
    expect(done.status).toBe("succeeded");
    const [copy] = await testDb.select().from(media).where(eq(media.id, done.resultMediaId!));
    expect(copy).toMatchObject({ derivedFromId: id, visibility: "private", status: "approved", width: 4096, height: 2731, capturedAt: "2026-06-14 18:30:00" });
    expect((await sharp(bucket.get(copy.blobPathname)!).metadata()).format).toBe("jpeg");
    // The temporary input is gone, and the copy gets a tile and a measurement.
    expect(bucket.has(enhanceInputKey(eventId, id))).toBe(false);
    const queued = (await testDb.select().from(jobs)).map((job) => job.kind);
    expect(queued).toEqual(expect.arrayContaining(["media.thumbnail", "media.analyze"]));
  });

  it("records a failed run without spending the allowance, and cleans up", async () => {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId);
    const row = await requestEnhancement({ event, mediaId: id, userId: owner });
    await runEnhancement({ enhancementId: row.id }, context);
    predictionStatus = "failed";
    await runEnhancement({ enhancementId: row.id }, context);
    const [done] = await testDb.select().from(aiEnhancements).where(eq(aiEnhancements.id, row.id));
    expect(done).toMatchObject({ status: "failed", error: "CUDA out of memory" });
    expect(bucket.has(enhanceInputKey(eventId, id))).toBe(false);
    expect((await enhancementAllowance(event)).used).toBe(0);
  });

  it("cancels a run that has gone on too long", async () => {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId);
    const row = await requestEnhancement({ event, mediaId: id, userId: owner });
    await runEnhancement({ enhancementId: row.id }, context);
    await testDb.update(aiEnhancements).set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(aiEnhancements.id, row.id));
    await runEnhancement({ enhancementId: row.id }, context);
    const calls = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.endsWith("/predictions/pred_1/cancel"))).toBe(true);
    expect((await testDb.select().from(aiEnhancements).where(eq(aiEnhancements.id, row.id)))[0].status).toBe("failed");
  });

  it("is brought forward by a signed webhook, and ignores an unsigned one", async () => {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId);
    const row = await requestEnhancement({ event, mediaId: id, userId: owner });
    await runEnhancement({ enhancementId: row.id }, context);
    const later = new Date(Date.now() + 60_000);
    await testDb.update(jobs).set({ runAfter: later }).where(eq(jobs.dedupeKey, `enhance:${row.id}`));

    const body = JSON.stringify({ id: "pred_1", status: "succeeded" });
    expect((await webhook(new Request("http://localhost/x", { method: "POST", body }))).status).toBe(401);

    const { createHmac } = await import("node:crypto");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from("k".repeat(32))).update(`msg_1.${timestamp}.${body}`).digest("base64");
    const response = await webhook(
      new Request("http://localhost/x", {
        method: "POST",
        body,
        headers: { "webhook-id": "msg_1", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` },
      }),
    );
    expect(response.status).toBe(200);
    const [job] = await testDb.select().from(jobs).where(eq(jobs.dedupeKey, `enhance:${row.id}`));
    expect(job.runAfter.getTime()).toBeLessThan(later.getTime());
  });
});

describe("the host's choice", () => {
  async function finished() {
    const { owner, eventId, event } = await premium();
    const id = await photo(eventId, { visibility: "link" });
    const row = await requestEnhancement({ event, mediaId: id, userId: owner });
    await runEnhancement({ enhancementId: row.id }, context);
    predictionStatus = "succeeded";
    await runEnhancement({ enhancementId: row.id }, context);
    const [done] = await testDb.select().from(aiEnhancements).where(eq(aiEnhancements.id, row.id));
    return { eventId, sourceId: id, resultId: done.resultMediaId!, enhancementId: row.id };
  }
  const visibility = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

  it("instead: the copy takes the original's place and the original is hidden", async () => {
    const { eventId, sourceId, resultId, enhancementId } = await finished();
    expect(await chooseEnhancement(eventId, enhancementId, "instead")).toBe(true);
    expect((await visibility(resultId)).visibility).toBe("link");
    expect((await visibility(sourceId)).visibility).toBe("private");
  });

  it("both: the copy is shown beside it; discarded: the copy goes to the trash", async () => {
    const first = await finished();
    await chooseEnhancement(first.eventId, first.enhancementId, "both");
    expect((await visibility(first.resultId)).visibility).toBe("link");
    expect((await visibility(first.sourceId)).visibility).toBe("link");

    await resetDatabase();
    bucket.clear();
    predictionStatus = "processing";
    const second = await finished();
    await chooseEnhancement(second.eventId, second.enhancementId, "discarded");
    expect((await visibility(second.resultId)).deletedAt).toBeInstanceOf(Date);
    expect((await visibility(second.sourceId)).visibility).toBe("link");
    // A gone result cannot be chosen again.
    expect(await chooseEnhancement(second.eventId, second.enhancementId, "both")).toBe(false);
  });
});
