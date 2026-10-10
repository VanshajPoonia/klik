import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";

// A bucket in memory, as in thumbnail-job.dbtest.ts. sharp is real.
const bucket = new Map<string, Buffer>();
const send = vi.fn(async (command: { constructor: { name: string }; input: { Key: string } }) => {
  if (command.constructor.name !== "GetObjectCommand") throw new Error(`Unexpected ${command.constructor.name}`);
  const bytes = bucket.get(command.input.Key);
  if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
});

let session: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
}));

const { analyzeMedia, backfillAnalysis } = await import("@/lib/job-handlers/analyze");
const { POST } = await import("@/app/api/events/[id]/media/bulk/route");
const { jobs, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, maxAttempts: 3, deadline: Date.now() + 60_000 };
const row = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

/** Black and white squares: as sharp as a photo gets. */
async function checkerboard(size = 400, square = 20) {
  const pixels = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[y * size + x] = (Math.floor(x / square) + Math.floor(y / square)) % 2 ? 255 : 0;
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();
}

beforeEach(async () => {
  bucket.clear();
  send.mockClear();
  session = null;
  await resetDatabase();
});
afterAll(closeDatabase);

describe("media.analyze", () => {
  it("measures a photo from its tile, and a sharp one above the same photo blurred", async () => {
    const eventId = await makeEvent(await makeUser());
    const crisp = await makeMedia(eventId, { thumbPathname: `events/${eventId}/crisp-thumb.jpg` });
    const soft = await makeMedia(eventId);
    bucket.set(`events/${eventId}/crisp-thumb.jpg`, await checkerboard());
    // No tile yet: the photo itself is read.
    bucket.set((await row(soft)).blobPathname, await sharp(await checkerboard()).blur(6).jpeg().toBuffer());

    await analyzeMedia({ mediaId: crisp }, context);
    await analyzeMedia({ mediaId: soft }, context);

    const [a, b] = [await row(crisp), await row(soft)];
    expect(a.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.analyzedAt).toBeInstanceOf(Date);
    expect(a.brightness).toBeGreaterThan(0.4);
    expect(a.brightness).toBeLessThan(0.6);
    expect(a.sharpness!).toBeGreaterThan(b.sharpness! * 5);
  });

  it("measures once, skips videos, and records an undecodable photo as measured with nothing", async () => {
    const eventId = await makeEvent(await makeUser());
    const done = await makeMedia(eventId, { analyzedAt: new Date(), sharpness: 7 });
    const video = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const broken = await makeMedia(eventId);
    bucket.set((await row(broken)).blobPathname, Buffer.from("not a jpeg at all"));

    await analyzeMedia({ mediaId: done }, context);
    await analyzeMedia({ mediaId: video }, context);
    expect(send).not.toHaveBeenCalled();
    expect((await row(done)).sharpness).toBe(7);

    await analyzeMedia({ mediaId: broken }, context);
    const after = await row(broken);
    expect(after.analyzedAt).toBeInstanceOf(Date);
    expect(after.perceptualHash).toBeNull();
  });

  it("queues the backfill for unmeasured photos only", async () => {
    const eventId = await makeEvent(await makeUser());
    const waiting = await makeMedia(eventId);
    await makeMedia(eventId, { analyzedAt: new Date() });
    await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    await makeMedia(eventId, { deletedAt: new Date() });

    await backfillAnalysis({}, context);
    const queued = await testDb.select().from(jobs).where(eq(jobs.kind, "media.analyze"));
    expect(queued.map((job) => (job.payload as { mediaId: string }).mediaId)).toEqual([waiting]);
  });
});

describe("AI-8 pinning through the bulk route", () => {
  const run = (eventId: string, body: Record<string, unknown>) =>
    POST(new Request(`https://klik.test/api/events/${eventId}/media/bulk`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: eventId }),
    });

  it("pins, excludes and hands back to the score, only in this event", async () => {
    const owner = await makeUser();
    session = { user: { id: owner, role: "organizer" } };
    const eventId = await makeEvent(owner);
    const theirs = await makeMedia(await makeEvent(await makeUser()));
    const ids = [await makeMedia(eventId), await makeMedia(eventId)];

    const pinned = await (await run(eventId, { action: "highlight", highlight: "pinned", ids: [...ids, theirs] })).json();
    expect(pinned.changed.sort()).toEqual([...ids].sort());
    expect((await row(theirs)).highlight).toBeNull();

    await run(eventId, { action: "highlight", highlight: "excluded", ids: [ids[0]] });
    await run(eventId, { action: "highlight", highlight: null, ids: [ids[1]] });
    const after = await testDb.select().from(media).where(inArray(media.id, ids));
    expect(Object.fromEntries(after.map((item) => [item.id, item.highlight]))).toEqual({ [ids[0]]: "excluded", [ids[1]]: null });

    expect((await run(eventId, { action: "highlight", highlight: "starred", ids })).status).toBe(400);
  });
});
