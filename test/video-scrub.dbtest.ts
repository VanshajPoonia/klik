import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { androidMoov, box, ftyp, iphoneVideo, mdat, mvhd } from "./fixtures/video";

/**
 * An in-memory R2, just the operations the scrub uses. Enough to run the real
 * handler end to end: plan from ranged reads, stream the rewrite through a
 * multipart upload, read it back.
 */
const objects = new Map<string, { body: Buffer; contentType: string; etag: string }>();
const uploads = new Map<string, { key: string; parts: Map<number, Buffer>; contentType: string }>();
const calls: string[] = [];
let onUploadPart: (() => Promise<void>) | null = null;

const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
  const name = command.constructor.name;
  const input = command.input;
  calls.push(name);
  const key = input.Key as string;
  switch (name) {
    case "HeadObjectCommand": {
      const object = objects.get(key);
      if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
      return { ContentLength: object.body.length, ContentType: object.contentType, ETag: object.etag };
    }
    case "GetObjectCommand": {
      const object = objects.get(key);
      if (!object) throw new Error("NoSuchKey");
      if (input.IfMatch && input.IfMatch !== object.etag) throw new Error("PreconditionFailed");
      let bytes = object.body;
      const range = /^bytes=(\d+)-(\d+)$/.exec((input.Range as string) ?? "");
      if (range) bytes = bytes.subarray(Number(range[1]), Number(range[2]) + 1);
      const { Readable } = await import("node:stream");
      const stream = Readable.from([bytes.subarray(0, 1000), bytes.subarray(1000)].filter((chunk) => chunk.length));
      return { Body: Object.assign(stream, { transformToByteArray: async () => new Uint8Array(bytes) }) };
    }
    case "CreateMultipartUploadCommand": {
      const id = `up_${uploads.size + 1}`;
      uploads.set(id, { key, parts: new Map(), contentType: input.ContentType as string });
      return { UploadId: id };
    }
    case "UploadPartCommand": {
      if (onUploadPart) await onUploadPart();
      uploads.get(input.UploadId as string)!.parts.set(input.PartNumber as number, Buffer.from(input.Body as Buffer));
      return { ETag: `"p${input.PartNumber}"` };
    }
    case "CompleteMultipartUploadCommand": {
      const upload = uploads.get(input.UploadId as string)!;
      const body = Buffer.concat([...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part));
      objects.set(upload.key, { body, contentType: upload.contentType, etag: `"v${calls.length}"` });
      return {};
    }
    case "AbortMultipartUploadCommand":
      return {};
    default:
      throw new Error(`Unexpected command ${name}`);
  }
});
const deleteBlobs = vi.fn(async (keys: string[]) => {
  for (const key of keys) objects.delete(key);
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
  deleteBlobs,
}));

const { scrubVideo, backfillVideoScrubs } = await import("@/lib/job-handlers/video-scrub");
const { media, jobs } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = () => ({ jobId: "job", attempt: 1, maxAttempts: 4, deadline: Date.now() + 250_000 });

async function videoWith(bytes: Buffer, overrides: Partial<typeof media.$inferInsert> = {}) {
  const eventId = await makeEvent(await makeUser());
  const id = await makeMedia(eventId, {
    kind: "video",
    mimeType: "video/quicktime",
    metadataState: "pending",
    ...overrides,
  });
  const [row] = await testDb.select().from(media).where(eq(media.id, id));
  objects.set(row.blobPathname, { body: bytes, contentType: row.mimeType, etag: '"v0"' });
  return row;
}

const rowOf = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];

beforeEach(async () => {
  objects.clear();
  uploads.clear();
  calls.length = 0;
  onUploadPart = null;
  send.mockClear();
  deleteBlobs.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("scrubVideo", () => {
  it("removes an iPhone location in place, keeps the size, and records the capture time", async () => {
    const original = iphoneVideo();
    const row = await videoWith(original);
    await scrubVideo({ mediaId: row.id }, context());

    const stored = objects.get(row.blobPathname)!;
    expect(stored.body.length).toBe(original.length);
    expect(stored.body.includes(Buffer.from("+51.5007"))).toBe(false);
    expect(stored.contentType).toBe("video/quicktime");
    const after = await rowOf(row.id);
    expect(after.metadataState).toBe("clean");
    expect(after.capturedAt).toBe("2023-07-15 14:03:12");
  });

  it("does not rewrite a video with nothing to remove", async () => {
    const row = await videoWith(Buffer.concat([ftyp(), box("moov", mvhd()), mdat()]));
    await scrubVideo({ mediaId: row.id }, context());
    expect(calls).not.toContain("CreateMultipartUploadCommand");
    expect((await rowOf(row.id)).metadataState).toBe("clean");
  });

  it("marks a file it cannot read as failed, so it stays held back", async () => {
    const row = await videoWith(Buffer.from("this is not a video at all, not even close"));
    await scrubVideo({ mediaId: row.id }, context());
    expect((await rowOf(row.id)).metadataState).toBe("failed");
  });

  it("passes WebM straight through as clean", async () => {
    const row = await videoWith(Buffer.alloc(100), { mimeType: "video/webm" });
    await scrubVideo({ mediaId: row.id }, context());
    expect(calls).toEqual([]);
    expect((await rowOf(row.id)).metadataState).toBe("clean");
  });

  it("does not leave an object behind when the video is erased mid-rewrite", async () => {
    const row = await videoWith(Buffer.concat([ftyp(), mdat(), androidMoov()]));
    onUploadPart = async () => {
      await testDb.delete(media).where(eq(media.id, row.id));
    };
    await scrubVideo({ mediaId: row.id }, context());
    expect(objects.has(row.blobPathname)).toBe(false);
  });

  it("is a no-op for a clean video or a photo", async () => {
    const clean = await videoWith(iphoneVideo(), { metadataState: "clean" });
    await scrubVideo({ mediaId: clean.id }, context());
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    await scrubVideo({ mediaId: photo }, context());
    expect(calls).toEqual([]);
  });

  it("waits for a run with enough time left rather than starting a rewrite it cannot finish", async () => {
    const row = await videoWith(iphoneVideo());
    const outcome = await scrubVideo({ mediaId: row.id }, { ...context(), deadline: Date.now() + 10_000 });
    expect(outcome).toMatchObject({ requeue: {} });
    expect(calls).toEqual([]);
  });
});

describe("backfillVideoScrubs", () => {
  it("queues videos never scrubbed and pending ones that were lost, and nothing else", async () => {
    const eventId = await makeEvent(await makeUser());
    const legacy = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const stuck = await makeMedia(eventId, {
      kind: "video",
      mimeType: "video/mp4",
      metadataState: "pending",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    await makeMedia(eventId, { kind: "video", mimeType: "video/mp4", metadataState: "pending" });
    await makeMedia(eventId, { kind: "video", mimeType: "video/mp4", metadataState: "clean" });
    await makeMedia(eventId);

    await backfillVideoScrubs();
    const queued = (await testDb.select().from(jobs)).map((job) => (job.payload as { mediaId: string }).mediaId).sort();
    expect(queued).toEqual([legacy, stuck].sort());
  });
});
