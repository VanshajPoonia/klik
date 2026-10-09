import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * OPS-3, the server's half: a registration sent twice by the queue is one
 * upload, and a large upload resumes with only the parts storage lacks.
 */

const viewer = {
  access: { allowed: true } as { allowed: boolean },
  guestId: null as string | null,
  kioskId: null as string | null,
  kioskAlbumId: null as string | null,
  ownerSession: null as unknown,
};
const r2Send = vi.fn();
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send: (command: unknown) => r2Send(command) },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_client: unknown, command: { input: { Key: string; PartNumber?: number } }) =>
    command.input.PartNumber ? `https://r2.test/part/${command.input.PartNumber}` : `https://r2.test/${command.input.Key}`,
}));

const { POST: register } = await import("@/app/api/e/[slug]/media/route");
const { POST: resume } = await import("@/app/api/upload/parts/route");
const { grantEntitlement } = await import("@/lib/entitlements");
const { blobPathnameFor } = await import("@/lib/storage");
const { MULTIPART_THRESHOLD, PART_SIZE } = await import("@/lib/upload-parts");
const { events, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  viewer.access = { allowed: true };
  viewer.guestId = null;
  viewer.kioskId = null;
  viewer.ownerSession = null;
  r2Send.mockReset();
  await resetDatabase();
});
afterAll(closeDatabase);

/** A live Premium event, licensed the way the app licenses one. */
async function liveEvent() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  await grantEntitlement({ userId: owner, planKey: "premium", source: "admin", reason: "Test", grantedBy: null });
  const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
  return event;
}

function post(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

describe("registering the same upload twice", () => {
  async function registerAgain(event: Awaited<ReturnType<typeof liveEvent>>, mediaId: string) {
    const response = await register(
      post(`/api/e/${event.slug}/media`, {
        mediaId,
        pathname: blobPathnameFor(event.id, mediaId, "jpg"),
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        clientCompressed: true,
      }),
      { params: Promise.resolve({ slug: event.slug }) },
    );
    return { status: response.status, body: await response.json() };
  }

  it("tells the guest who sent it that it is in, with the item, and adds nothing", async () => {
    const event = await liveEvent();
    const guest = await makeGuest(event.id);
    const mediaId = await makeMedia(event.id, { id: "queued_photo_1", guestId: guest });
    viewer.guestId = guest;

    const { status, body } = await registerAgain(event, mediaId);
    expect(status).toBe(200);
    expect(body.alreadyAdded).toBe(true);
    expect(body.media).toMatchObject({ id: mediaId, mine: true });
    expect(await testDb.select().from(media).where(eq(media.eventId, event.id))).toHaveLength(1);
    // Answered before storage is asked anything.
    expect(r2Send).not.toHaveBeenCalled();
  });

  it("does the same for the host's own upload", async () => {
    const event = await liveEvent();
    const mediaId = await makeMedia(event.id, { id: "queued_photo_2", guestId: null });
    viewer.ownerSession = { userId: "someone" };
    expect((await registerAgain(event, mediaId)).status).toBe(200);
  });

  it("refuses anyone else, and a photo in the trash", async () => {
    const event = await liveEvent();
    const owner = await makeGuest(event.id);
    const other = await makeGuest(event.id);
    const mediaId = await makeMedia(event.id, { id: "queued_photo_3", guestId: owner });
    const trashed = await makeMedia(event.id, { id: "queued_photo_4", guestId: owner, deletedAt: new Date() });

    viewer.guestId = other;
    expect((await registerAgain(event, mediaId)).status).toBe(409);
    viewer.ownerSession = { userId: "host" };
    viewer.guestId = null;
    expect((await registerAgain(event, mediaId)).status).toBe(409);
    viewer.ownerSession = null;
    viewer.guestId = owner;
    expect((await registerAgain(event, trashed)).status).toBe(409);
  });
});

describe("resuming a large upload", () => {
  const sizeBytes = MULTIPART_THRESHOLD + PART_SIZE + 1_000;

  async function resumeIt(event: Awaited<ReturnType<typeof liveEvent>>, extra: Record<string, unknown> = {}) {
    const response = await resume(
      post("/api/upload/parts", {
        eventId: event.id,
        mediaId: "queued_video_1",
        mimeType: "video/mp4",
        sizeBytes,
        uploadId: "upload-1",
        ...extra,
      }),
    );
    return { status: response.status, body: await response.json() };
  }

  it("signs only the parts storage does not hold whole, at the key the media id gives", async () => {
    const event = await liveEvent();
    viewer.guestId = await makeGuest(event.id);
    const total = Math.ceil(sizeBytes / PART_SIZE);
    r2Send.mockImplementation(async (command: { input: { Key: string; UploadId: string } }) => {
      expect(command.input).toMatchObject({ Key: blobPathnameFor(event.id, "queued_video_1", "mp4"), UploadId: "upload-1" });
      return {
        Parts: [
          { PartNumber: 1, Size: PART_SIZE, ETag: "a" },
          // Cut short by the connection: sent again.
          { PartNumber: 2, Size: 100, ETag: "b" },
          { PartNumber: 4, Size: PART_SIZE, ETag: "d" },
        ],
        IsTruncated: false,
      };
    });

    const { status, body } = await resumeIt(event, { posterBytes: 5_000 });
    expect(status).toBe(200);
    expect(body.partSize).toBe(PART_SIZE);
    expect(body.arrived).toEqual([1, 4]);
    const wanted = Array.from({ length: total }, (_, index) => index + 1).filter((number) => number !== 1 && number !== 4);
    expect(body.parts).toEqual(wanted.map((number) => ({ number, url: `https://r2.test/part/${number}` })));
    expect(body.posterUploadUrl).toContain("poster");
  });

  it("says when storage no longer has the upload, so the device starts again", async () => {
    const event = await liveEvent();
    viewer.guestId = await makeGuest(event.id);
    r2Send.mockRejectedValue(Object.assign(new Error("NoSuchUpload"), { name: "NoSuchUpload" }));
    expect((await resumeIt(event)).status).toBe(404);
  });

  it("refuses once registered, once uploads close, a small file, and a stranger", async () => {
    const event = await liveEvent();
    viewer.guestId = await makeGuest(event.id);
    r2Send.mockResolvedValue({ Parts: [], IsTruncated: false });

    expect((await resumeIt(event, { sizeBytes: 1_000 })).status).toBe(400);

    await makeMedia(event.id, { id: "queued_video_1", guestId: viewer.guestId, kind: "video", mimeType: "video/mp4" });
    expect((await resumeIt(event)).status).toBe(409);
    await testDb.delete(media).where(eq(media.id, "queued_video_1"));

    viewer.guestId = null;
    expect((await resumeIt(event)).status).toBe(401);
    viewer.guestId = await makeGuest(event.id);

    await testDb.update(events).set({ uploadsEnabled: false }).where(eq(events.id, event.id));
    expect((await resumeIt(event)).status).toBe(403);
  });
});
