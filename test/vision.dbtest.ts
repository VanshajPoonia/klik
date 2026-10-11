import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";

// A bucket in memory; sharp is real. Workers AI is a fake `fetch` below.
const bucket = new Map<string, Buffer>();
const send = vi.fn(async (command: { constructor: { name: string }; input: { Key: string } }) => {
  if (command.constructor.name !== "GetObjectCommand") throw new Error(`Unexpected ${command.constructor.name}`);
  const bytes = bucket.get(command.input.Key);
  if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
});
const sendEmail = vi.fn(async () => ({ id: "email" }));

let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
}));

const { describeMedia, backfillVision } = await import("@/lib/job-handlers/vision");
const { searchByText, searchByScene, gallerySearch, createSmartFolder, searchBySmartFolder, listSmartFolders } = await import(
  "@/lib/search"
);
const { galleryMoments } = await import("@/lib/folders");
const { openReportCounts, resolveReports, listOpenReports } = await import("@/lib/reports");
const { SCREENING_REPORTER } = await import("@/lib/screening");
const { GET: dashboardSearch } = await import("@/app/api/events/[id]/search/route");
const { albums, jobs, media, mediaReports, mediaVision } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, maxAttempts: 4, deadline: Date.now() + 60_000 };

/**
 * Embeddings a test can reason about: one axis per topic word, so "cake"
 * is near every caption about cake and nowhere near one about dancing.
 */
const TOPICS = ["cake", "dessert", "danc", "speech", "dog", "flower", "beach", "toast"];
function fakeVector(text: string): number[] {
  const vector = new Array(1024).fill(0);
  const lower = text.toLowerCase();
  TOPICS.forEach((topic, axis) => {
    if (lower.includes(topic)) vector[axis] = 1;
  });
  vector[1023] = 0.05;
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

/** What the vision model answers next, per media id the test is describing. */
let answer: unknown = null;
let visionStatus = 200;
const calls: string[] = [];

function workersAi(url: string, init?: RequestInit): Response {
  const model = url.split("/ai/run/")[1];
  calls.push(model);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (model.includes("bge-m3")) {
    const texts: string[] = body.text;
    return Response.json({ success: true, result: { shape: [texts.length, 1024], data: texts.map(fakeVector), pooling: "cls" } });
  }
  if (body.prompt === "agree") return Response.json({ success: true, result: { response: "Thank you for agreeing" } });
  if (visionStatus !== 200) {
    return Response.json({ success: false, errors: [{ message: `status ${visionStatus}` }] }, { status: visionStatus });
  }
  return Response.json({ success: true, result: { response: answer } });
}

const describedAs = (caption: string, labels: string[], flags: Partial<Record<"sexual_content" | "graphic_violence" | "hate_symbol", boolean>> = {}) =>
  JSON.stringify({ caption, labels, sexual_content: false, graphic_violence: false, hate_symbol: false, ...flags });

async function tile() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 80 } } }).jpeg().toBuffer();
}

async function photo(eventId: string, overrides: Parameters<typeof makeMedia>[1] = {}) {
  const id = await makeMedia(eventId, overrides);
  const [row] = await testDb.select().from(media).where(eq(media.id, id));
  bucket.set(row.thumbPathname ?? row.blobPathname, await tile());
  return id;
}

async function described(eventId: string, caption: string, labels: string[], overrides: Parameters<typeof makeMedia>[1] = {}) {
  const id = await photo(eventId, overrides);
  answer = describedAs(caption, labels);
  await describeMedia({ mediaId: id }, context);
  return id;
}

const visionRow = async (id: string) => (await testDb.select().from(mediaVision).where(eq(mediaVision.mediaId, id)))[0];
const mediaRow = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

beforeEach(async () => {
  bucket.clear();
  send.mockClear();
  sendEmail.mockClear();
  calls.length = 0;
  answer = null;
  visionStatus = 200;
  session = null;
  process.env.CLOUDFLARE_AI_API_TOKEN = "test-token";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => workersAi(String(input), init)));
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
});
afterAll(closeDatabase);

describe("media.describe", () => {
  it("stores a caption, known labels only, and an embedding of both", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId, { thumbPathname: `events/${eventId}/t.jpg` });
    answer = "Sure! ```json\n" + describedAs("A three tier cake on a long table", ["cake", "decor", "unicorns"]) + "\n```";
    await describeMedia({ mediaId: id }, context);

    const row = await visionRow(id);
    expect(row).toMatchObject({ state: "done", caption: "A three tier cake on a long table", labels: ["cake", "decor"], safety: "clear" });
    expect(row.embedding).toHaveLength(1024);
    expect(row.embedding![0]).toBeGreaterThan(0.5);
    expect(send.mock.calls[0][0].input.Key).toBe(`events/${eventId}/t.jpg`);
    expect(calls).toEqual(["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/baai/bge-m3"]);
    expect((await mediaRow(id)).status).toBe("approved");
  });

  it("does nothing at all without a key, and describes each photo once", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
    await describeMedia({ mediaId: id }, context);
    expect(send).not.toHaveBeenCalled();
    expect(await visionRow(id)).toBeUndefined();

    process.env.CLOUDFLARE_AI_API_TOKEN = "test-token";
    answer = describedAs("Two people dancing", ["dancing"]);
    await describeMedia({ mediaId: id }, context);
    await describeMedia({ mediaId: id }, context);
    expect(calls.filter((model) => model.includes("llama"))).toHaveLength(1);
  });

  it("reads a video by its poster, and skips one without a poster or a deleted photo", async () => {
    const eventId = await makeEvent(await makeUser());
    const video = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4", posterPathname: `events/${eventId}/p.jpg` });
    bucket.set(`events/${eventId}/p.jpg`, await tile());
    const bare = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const gone = await photo(eventId, { deletedAt: new Date() });
    answer = describedAs("People dancing under lights", ["dancing", "lights"]);
    for (const id of [video, bare, gone]) await describeMedia({ mediaId: id }, context);
    expect((await visionRow(video))?.labels).toEqual(["dancing", "lights"]);
    expect(await visionRow(bare)).toBeUndefined();
    expect(await visionRow(gone)).toBeUndefined();
  });

  it("accepts Meta's licence once when the model asks, then describes", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (first && String(input).includes("llama") && body.messages) {
          first = false;
          return Response.json({ success: false, errors: [{ message: "Prior to using this model, you must submit the prompt 'agree'" }] }, { status: 403 });
        }
        return workersAi(String(input), init);
      }),
    );
    answer = describedAs("A dog in a bow tie", ["pets"]);
    await describeMedia({ mediaId: id }, context);
    expect((await visionRow(id))?.labels).toEqual(["pets"]);
  });

  it("retries an outage, then records a failure on the last attempt so the backfill stops paying for it", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    visionStatus = 503;
    await expect(describeMedia({ mediaId: id }, context)).rejects.toThrow(/503/);
    expect(await visionRow(id)).toBeUndefined();
    await describeMedia({ mediaId: id }, { ...context, attempt: 4 });
    expect((await visionRow(id))?.state).toBe("failed");
  });

  it("records a request Workers AI refuses outright as failed without retrying", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    visionStatus = 400;
    await describeMedia({ mediaId: id }, context);
    expect((await visionRow(id))?.state).toBe("failed");
  });
});

describe("AI-6 screening", () => {
  it("holds a flagged photo for the organizer, files it in Klik's queue, and emails once", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const first = await photo(eventId);
    const second = await photo(eventId);
    answer = describedAs("A person", [], { sexual_content: true });
    await describeMedia({ mediaId: first }, context);
    await describeMedia({ mediaId: second }, context);

    expect((await mediaRow(first)).status).toBe("pending");
    expect(await visionRow(first)).toMatchObject({ safety: "flagged", safetyReasons: ["sexual"] });
    const [report] = await testDb.select().from(mediaReports).where(eq(mediaReports.mediaId, first));
    expect(report).toMatchObject({ reporterKey: SCREENING_REPORTER, reason: "nudity", reporterGuestId: null });
    expect(report.note).toContain("nudity or sexual content");
    // Throttled: a burst is one message.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendEmail.mock.calls[0])).toContain("held back a photo");

    // The organizer's grid counts guests' reports, not screening's, and their
    // "clear" leaves Klik's report open. Klik's own queue shows and closes it.
    expect((await openReportCounts(eventId)).get(first)).toBeUndefined();
    expect(await resolveReports(first, { byUserId: owner, resolution: "fine" })).toBe(0);
    const queue = await listOpenReports();
    expect(queue.find((row) => row.mediaId === first)?.screened).toBe(true);
    expect(await resolveReports(first, { byUserId: owner, resolution: "Kept by Klik.", includeScreening: true })).toBe(1);
  });

  it("holds a photo the model will not describe, without filing it with Klik", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    answer = "I'm sorry, but I can't help with describing this image.";
    await describeMedia({ mediaId: id }, context);
    expect(await visionRow(id)).toMatchObject({ state: "done", safety: "unclear", caption: null });
    expect((await mediaRow(id)).status).toBe("pending");
    expect(await testDb.select().from(mediaReports)).toHaveLength(0);
  });

  it("leaves a photo the organizer is already holding where it is", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId, { status: "pending" });
    answer = describedAs("A fight", [], { graphic_violence: true });
    await describeMedia({ mediaId: id }, context);
    expect((await mediaRow(id)).status).toBe("pending");
    const [report] = await testDb.select().from(mediaReports).where(eq(mediaReports.mediaId, id));
    expect(report.reason).toBe("violence");
  });
});

describe("the backfill", () => {
  it("queues what has no description, newest first, never rejected photos or posterless videos, and nothing without a key", async () => {
    const eventId = await makeEvent(await makeUser());
    const older = await makeMedia(eventId, { createdAt: new Date("2026-01-01") });
    const newer = await makeMedia(eventId, { createdAt: new Date("2026-06-01") });
    await makeMedia(eventId, { status: "rejected" });
    await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const poster = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4", posterPathname: "p.jpg" });
    const done = await makeMedia(eventId);
    await testDb.insert(mediaVision).values({ mediaId: done, eventId, state: "failed", model: "m" });

    delete process.env.CLOUDFLARE_AI_API_TOKEN;
    await backfillVision({}, context);
    expect(await testDb.select().from(jobs)).toHaveLength(0);

    process.env.CLOUDFLARE_AI_API_TOKEN = "test-token";
    await backfillVision({}, context);
    const queued = (await testDb.select().from(jobs)).map((job) => (job.payload as { mediaId: string }).mediaId);
    expect(new Set(queued)).toEqual(new Set([older, newer, poster]));
    expect(queued.indexOf(newer)).toBeLessThan(queued.indexOf(older));
  });
});

describe("search, scenes and smart folders", () => {
  async function party() {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const event = { id: eventId, uploaderSeesOwnPrivate: false, disposableMode: false, developsAt: null, scenesEnabled: true };
    const cake = [] as string[];
    for (let index = 0; index < 4; index += 1) cake.push(await described(eventId, `A wedding cake with flowers ${index}`, ["cake", "decor"]));
    // Labelled cake, captioned about something else: found by the label.
    const plate = await described(eventId, "A plate on a table", ["cake"]);
    const dance = await described(eventId, "Guests dancing at night", ["dancing"]);
    const hidden = await described(eventId, "A cake nobody may see", ["cake"], { visibility: "private" });
    return { owner, eventId, event, cake, plate, dance, hidden };
  }

  it("finds by meaning, puts label matches in, and leaves out what is not close", async () => {
    const { event, cake, plate, dance, hidden } = await party();
    const guest = { isManager: false, guestId: null };
    const found = (await searchByText(event, guest, "the cake")).map((row) => row.id);
    expect(new Set(found)).toEqual(new Set([...cake, plate]));
    expect(found).not.toContain(dance);
    expect(found).not.toContain(hidden);
    // The team sees the hidden one too.
    expect((await searchByText(event, { isManager: true, guestId: null }, "cake")).map((row) => row.id)).toContain(hidden);
    // A query naming no label and matching nothing finds nothing.
    expect(await searchByText(event, guest, "a beach")).toEqual([]);
  });

  it("lists a scene newest first, and offers scenes only with enough photos a viewer can see", async () => {
    const { event, eventId, cake, plate } = await party();
    const guest = { isManager: false, guestId: null };
    const scene = (await searchByScene(event, guest, "cake")).map((row) => row.id);
    expect(new Set(scene)).toEqual(new Set([...cake, plate]));

    const payload = await gallerySearch(event, guest);
    expect(payload.searchable).toBe(true);
    // cake 5 (the hidden one not counted), decor 4, dancing 1 (too few).
    expect(payload.scenes).toEqual([
      { label: "cake", count: 5 },
      { label: "decor", count: 4 },
    ]);
    expect(await gallerySearch({ ...event, scenesEnabled: false }, guest)).toEqual({ searchable: false, scenes: [], folders: [] });
    expect((await gallerySearch({ ...event, scenesEnabled: false }, { isManager: true, guestId: null })).scenes[0]).toEqual({
      label: "cake",
      count: 6,
    });
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
    expect((await gallerySearch(event, guest)).searchable).toBe(false);
    void eventId;
  });

  it("a guest's own held photo is theirs to find, nobody else's", async () => {
    const { event, eventId } = await party();
    const guestId = await makeGuest(eventId);
    const mine = await described(eventId, "My cake selfie", ["cake", "selfie"], { status: "pending", guestId });
    expect((await searchByScene(event, { isManager: false, guestId }, "cake")).map((row) => row.id)).toContain(mine);
    expect((await searchByScene(event, { isManager: false, guestId: null }, "cake")).map((row) => row.id)).not.toContain(mine);
  });

  it("saves a search as a smart folder that keeps working without the key, beside moments rather than among them", async () => {
    const { event, eventId, cake, plate } = await party();
    const folder = await createSmartFolder(eventId, { name: "The cake", query: { type: "search", text: "cake" } });
    const sceneFolder = await createSmartFolder(eventId, { name: "Dance floor", query: { type: "scene", label: "dancing" } });
    expect((await listSmartFolders(eventId)).map((row) => row.name)).toEqual(["The cake", "Dance floor"]);
    const [stored] = await testDb.select().from(albums).where(eq(albums.id, folder.id));
    expect((stored.query as { vector: number[] }).vector).toHaveLength(1024);

    delete process.env.CLOUDFLARE_AI_API_TOKEN;
    const guest = { isManager: false, guestId: null };
    expect(new Set((await searchBySmartFolder(event, guest, stored)).map((row) => row.id))).toEqual(new Set([...cake, plate]));
    const [scene] = await testDb.select().from(albums).where(eq(albums.id, sceneFolder.id));
    expect(await searchBySmartFolder(event, guest, scene)).toHaveLength(1);

    // Moments are smart albums too; smart folders must not show up as moments.
    expect(await galleryMoments({ id: eventId, momentsEnabled: true }, { isManager: true })).toEqual([]);
  });

  it("answers the dashboard with ids, for the event's team only", async () => {
    const { owner, eventId, cake } = await party();
    const request = (query: string) => new Request(`http://localhost/api/events/${eventId}/search?${query}`);
    const params = { params: Promise.resolve({ id: eventId }) };
    expect((await dashboardSearch(request("scene=cake"), params)).status).toBe(401);

    session = { user: { id: owner, role: "organizer" } };
    const response = await dashboardSearch(request("scene=cake"), params);
    expect(response.status).toBe(200);
    const { ids } = (await response.json()) as { ids: string[] };
    expect(ids).toEqual(expect.arrayContaining(cake));
    expect((await dashboardSearch(request("scene=unicorns"), params)).status).toBe(400);
  });
});

describe("the reports tables", () => {
  it("keep one screening report per photo however often it is filed", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await photo(eventId);
    const { holdForReview } = await import("@/lib/screening");
    await holdForReview({ mediaId: id, eventId, safety: "flagged", reasons: ["hate"] });
    await holdForReview({ mediaId: id, eventId, safety: "flagged", reasons: ["hate"] });
    const reports = await testDb
      .select()
      .from(mediaReports)
      .where(and(eq(mediaReports.mediaId, id), eq(mediaReports.reporterKey, SCREENING_REPORTER)));
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe("harassment");
  });
});
