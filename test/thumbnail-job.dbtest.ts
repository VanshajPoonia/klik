import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";

// A bucket in memory: GetObject reads from it, PutObject writes to it. sharp is
// real, so the thumbnail that comes out is a real JPEG of the right size.
const bucket = new Map<string, Buffer>();
const send = vi.fn(async (command: { constructor: { name: string }; input: { Key: string; Body?: Buffer } }) => {
  const { Key, Body } = command.input;
  if (command.constructor.name === "GetObjectCommand") {
    const bytes = bucket.get(Key);
    if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
  }
  if (command.constructor.name === "PutObjectCommand") {
    bucket.set(Key, Body as Buffer);
    return {};
  }
  throw new Error(`Unexpected command ${command.constructor.name}`);
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
}));

const { generateThumbnail, backfillThumbnails } = await import("@/lib/job-handlers/thumbnail");
const { jobs, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, deadline: Date.now() + 60_000 };
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#e8f000" } }).jpeg().toBuffer();
const mediaRow = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

beforeEach(async () => {
  bucket.clear();
  send.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("generateThumbnail", () => {
  it("makes a 480px-short-side JPEG next to the photo and records it", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    bucket.set(`events/${eventId}/${id}.jpg`, await photo(4032, 3024));

    await generateThumbnail({ mediaId: id }, context);

    const key = `events/${eventId}/${id}-thumb.jpg`;
    expect((await mediaRow(id)).thumbPathname).toBe(key);
    const meta = await sharp(bucket.get(key)!).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({
      format: "jpeg",
      width: 640,
      height: 480,
    });
  });

  it("does nothing for a row that already has one, so a retry cannot overwrite the client's", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId, { thumbPathname: "events/x/from-the-browser.jpg" });
    await generateThumbnail({ mediaId: id }, context);
    expect(send).not.toHaveBeenCalled();
    expect((await mediaRow(id)).thumbPathname).toBe("events/x/from-the-browser.jpg");
  });

  it("thumbnails a video from its poster, never from the video", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId, {
      kind: "video",
      mimeType: "video/quicktime",
      blobPathname: `events/${eventId}/v.mov`,
      posterPathname: `events/${eventId}/v-poster.jpg`,
    });
    bucket.set(`events/${eventId}/v-poster.jpg`, await photo(1280, 720));
    await generateThumbnail({ mediaId: id }, context);
    expect((await mediaRow(id)).thumbPathname).toBe(`events/${eventId}/${id}-thumb.jpg`);
    const reads = send.mock.calls.filter(([command]) => command.constructor.name === "GetObjectCommand");
    expect(reads.map(([command]) => command.input.Key)).toEqual([`events/${eventId}/v-poster.jpg`]);
  });

  it("leaves a video with no poster alone", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    await generateThumbnail({ mediaId: id }, context);
    expect(send).not.toHaveBeenCalled();
  });

  it("finishes quietly on bytes it cannot decode, rather than retrying the impossible", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    bucket.set(`events/${eventId}/${id}.jpg`, Buffer.from("not an image at all"));
    await expect(generateThumbnail({ mediaId: id }, context)).resolves.toBeUndefined();
    expect((await mediaRow(id)).thumbPathname).toBeNull();
  });

  it("throws when the source is missing, so the queue retries a transient failure", async () => {
    const eventId = await makeEvent(await makeUser());
    const id = await makeMedia(eventId);
    await expect(generateThumbnail({ mediaId: id }, context)).rejects.toThrow("NoSuchKey");
  });
});

describe("backfillThumbnails", () => {
  it("queues a job for each photo or postered video that lacks a thumbnail, once", async () => {
    const eventId = await makeEvent(await makeUser());
    const needs = await makeMedia(eventId);
    await makeMedia(eventId, { thumbPathname: "done.jpg" });
    await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const postered = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4", posterPathname: "p.jpg" });

    await backfillThumbnails({}, context);
    await backfillThumbnails({}, context);

    const queued = (await testDb.select().from(jobs)).map((job) => (job.payload as { mediaId: string }).mediaId);
    expect(queued.sort()).toEqual([needs, postered].sort());
  });
});
