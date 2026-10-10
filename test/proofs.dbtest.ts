import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * MED-10: watermarked proofs, through the real routes against a bucket kept
 * in memory and real sharp. The property that matters: nobody but the
 * photographer is ever handed the clean original until they release it.
 */

const bucket = new Map<string, Buffer>();
const viewer = {
  access: { allowed: true } as { allowed: boolean },
  guestId: null as string | null,
  kioskId: null as string | null,
  kioskAlbumId: null as string | null,
  ownerSession: null as { user: { id: string } } | null,
};
const session = { user: null as { id: string; role?: string } | null };

function fakeR2(command: unknown) {
  if (command instanceof PutObjectCommand) {
    bucket.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
    return {};
  }
  if (command instanceof DeleteObjectsCommand) {
    for (const object of command.input.Delete?.Objects ?? []) bucket.delete(object.Key!);
    return {};
  }
  const key = (command as { input: { Key: string } }).input.Key;
  const stored = bucket.get(key);
  if (!stored) throw Object.assign(new Error(`NoSuchKey ${key}`), { name: "NoSuchKey" });
  if (command instanceof HeadObjectCommand) return { ContentLength: stored.length };
  if (command instanceof GetObjectCommand) {
    const range = /bytes=(\d+)-(\d+)/.exec(command.input.Range ?? "");
    const data = range ? stored.subarray(Number(range[1]), Number(range[2]) + 1) : stored;
    return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
  }
  throw new Error("Unexpected storage call");
}

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/event-viewer", () => ({ resolveEventViewer: async () => viewer }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send: async (command: unknown) => fakeR2(command) },
  deleteBlobs: async (keys: string[]) => keys.forEach((key) => bucket.delete(key)),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_client: unknown, command: { input: { Key: string } }) => `https://r2.test/${command.input.Key}`,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const { POST: register } = await import("@/app/api/e/[slug]/media/route");
const { GET: content } = await import("@/app/api/e/[slug]/media/[mediaId]/content/route");
const { GET: download } = await import("@/app/api/e/[slug]/media/[mediaId]/download/route");
const { GET: proofNoteRoute } = await import("@/app/api/e/[slug]/media/[mediaId]/proof/route");
const { POST: release } = await import("@/app/api/events/[id]/proofs/release/route");
const { POST: uploadSlot } = await import("@/app/api/upload/route");
const { grantEntitlement } = await import("@/lib/entitlements");
const { editableOriginal } = await import("@/lib/media-edits");
const { mediaObjectKeys } = await import("@/lib/media-objects");
const { toGalleryMedia } = await import("@/lib/gallery-media");
const { blobPathnameFor, proofPathnameFor, thumbPathnameFor } = await import("@/lib/storage");
const { auditLog, events, jobs, media, watermarks } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeUser, resetDatabase, testDb } = await import("./harness");

let photoBytes: Buffer;
let stampBytes: Buffer;

beforeEach(async () => {
  bucket.clear();
  viewer.access = { allowed: true };
  viewer.guestId = null;
  viewer.ownerSession = null;
  session.user = null;
  await resetDatabase();
  photoBytes ??= await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 60, b: 90 } } }).jpeg().toBuffer();
  stampBytes ??= await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
});
afterAll(closeDatabase);

async function setup(planKey: "premium" | "event" = "premium") {
  const owner = await makeUser();
  const photographer = await makeUser({ name: "Jo Lens" });
  const eventId = await makeEvent(owner);
  await grantEntitlement({ userId: owner, planKey, source: "admin", reason: "Test", grantedBy: null });
  const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
  bucket.set(`watermarks/${photographer}/stamp.png`, stampBytes);
  await testDb.insert(watermarks).values({
    userId: photographer,
    stampKey: `watermarks/${photographer}/stamp.png`,
    stampWidth: 400,
    stampHeight: 100,
    label: "© Jo Lens Photography",
    buyNote: "Full photos are $15 each.",
    buyUrl: "mailto:jo@example.test",
  });
  return { owner, photographer, event };
}

function post(url: string, body: unknown) {
  return new Request(`https://example.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.20" },
    body: JSON.stringify(body),
  });
}

/** Uploads one photo as the current viewer: the bytes, a clean tile, then registration. */
async function upload(event: { id: string; slug: string }, mediaId: string, extra: Record<string, unknown> = {}, mimeType = "image/jpeg") {
  const pathname = blobPathnameFor(event.id, mediaId, mimeType === "video/mp4" ? "mp4" : "jpg");
  bucket.set(pathname, photoBytes);
  bucket.set(thumbPathnameFor(event.id, mediaId), Buffer.from("clean-thumbnail-from-the-browser"));
  const response = await register(
    post(`/api/e/${event.slug}/media`, {
      mediaId,
      pathname,
      mimeType,
      sizeBytes: photoBytes.length,
      clientCompressed: true,
      thumbPathname: thumbPathnameFor(event.id, mediaId),
      ...extra,
    }),
    { params: Promise.resolve({ slug: event.slug }) },
  );
  return { status: response.status, body: await response.json(), pathname };
}

async function servedKey(route: typeof content, event: { slug: string }, mediaId: string) {
  const response = await route(new Request(`https://example.test/api/e/${event.slug}/media/${mediaId}/content`), {
    params: Promise.resolve({ slug: event.slug, mediaId }),
  });
  return response.headers.get("location")?.replace("https://r2.test/", "") ?? `status ${response.status}`;
}

describe("MED-10 uploading a proof", () => {
  it("stores the watermarked copy as the photo and keeps the original apart", async () => {
    const { photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };

    const { status, body, pathname } = await upload(event, "proof_photo_01", { proof: true });
    expect(status).toBe(201);
    expect(body.media.proof).toBe(true);

    const [row] = await testDb.select().from(media).where(eq(media.id, "proof_photo_01"));
    expect(row.blobPathname).toBe(proofPathnameFor(event.id, "proof_photo_01"));
    expect(row.proofOriginalPathname).toBe(pathname);
    expect(row.proofBy).toBe(photographer);
    // The stamped copy really differs, and the browser's clean tile was replaced.
    expect(bucket.get(row.blobPathname)!.equals(photoBytes)).toBe(false);
    expect(bucket.get(row.thumbPathname!)!.toString()).not.toBe("clean-thumbnail-from-the-browser");
    // Erasure, the purge and the reaper all see the original.
    expect(mediaObjectKeys([row])).toContain(pathname);
  });

  it("refuses a guest, a plan without proofs, a photographer with no watermark, and a video", async () => {
    const { photographer, event } = await setup();
    viewer.guestId = await makeGuest(event.id);
    expect((await upload(event, "proof_guest_01", { proof: true })).status).toBe(403);

    viewer.guestId = null;
    viewer.ownerSession = { user: { id: await makeUser() } };
    expect((await upload(event, "proof_nomark_01", { proof: true })).status).toBe(422);

    viewer.ownerSession = { user: { id: photographer } };
    expect((await upload(event, "proof_video_01", { proof: true }, "video/mp4")).status).toBe(422);

    const small = await setup("event");
    viewer.ownerSession = { user: { id: small.photographer } };
    expect((await upload(small.event, "proof_plan_01", { proof: true })).status).toBe(403);
    expect(await testDb.select().from(media)).toHaveLength(0);
  });

  it("refuses an upload slot whose id would name another photo's thumbnail", async () => {
    const { owner, event } = await setup();
    viewer.ownerSession = { user: { id: owner } };
    const response = await uploadSlot(
      post("/api/upload", { eventId: event.id, mediaId: "proof_photo_01-thumb", mimeType: "image/jpeg", sizeBytes: 1000 }),
    );
    expect(response.status).toBe(400);
  });
});

describe("MED-10 who sees what", () => {
  it("serves the photographer the original and everyone else, the owner included, the watermark", async () => {
    const { owner, photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };
    const { pathname } = await upload(event, "proof_photo_02", { proof: true });
    const watermarked = proofPathnameFor(event.id, "proof_photo_02");

    expect(await servedKey(content, event, "proof_photo_02")).toBe(pathname);
    expect(await servedKey(download, event, "proof_photo_02")).toBe(pathname);

    viewer.ownerSession = { user: { id: owner } };
    expect(await servedKey(content, event, "proof_photo_02")).toBe(watermarked);
    expect(await servedKey(download, event, "proof_photo_02")).toBe(watermarked);

    viewer.ownerSession = null;
    viewer.guestId = await makeGuest(event.id);
    expect(await servedKey(content, event, "proof_photo_02")).toBe(watermarked);

    // And the gallery's signed tiles, which every other path is built like.
    const [row] = await testDb.select().from(media).where(eq(media.id, "proof_photo_02"));
    const [item] = await toGalleryMedia([row], event.slug);
    expect(item.src).toBe(`https://r2.test/${watermarked}`);
    expect(item.proof).toBe(true);
  });

  it("tells viewers whose proof it is and how to buy it", async () => {
    const { photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };
    await upload(event, "proof_photo_03", { proof: true });
    viewer.ownerSession = null;
    viewer.guestId = await makeGuest(event.id);
    const response = await proofNoteRoute(new Request("https://example.test"), {
      params: Promise.resolve({ slug: event.slug, mediaId: "proof_photo_03" }),
    });
    expect(await response.json()).toEqual({ by: "© Jo Lens Photography", note: "Full photos are $15 each.", url: "mailto:jo@example.test" });
  });

  it("lets only the photographer edit a locked proof, and their edit is a proof too", async () => {
    const { owner, photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };
    await upload(event, "proof_photo_04", { proof: true });

    const asOwner = await editableOriginal(event, "proof_photo_04", { isManager: true, guestId: null, kioskId: null, userId: owner });
    expect(asOwner).toEqual({ refused: "proof" });

    const { status } = await upload(event, "proof_edit_04", { derivedFromId: "proof_photo_04" });
    expect(status).toBe(201);
    const [copy] = await testDb.select().from(media).where(eq(media.id, "proof_edit_04"));
    expect(copy.proofBy).toBe(photographer);
    expect(copy.blobPathname).toBe(proofPathnameFor(event.id, "proof_edit_04"));
  });
});

describe("MED-10 releasing", () => {
  async function releaseAs(user: { id: string; role?: string } | null, eventId: string, body: unknown = {}) {
    session.user = user;
    const response = await release(post(`/api/events/${eventId}/proofs/release`, body), { params: Promise.resolve({ id: eventId }) });
    return { status: response.status, body: await response.json() };
  }

  it("is the photographer's alone, and swaps the original in for everyone", async () => {
    const { owner, photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };
    const { pathname } = await upload(event, "proof_photo_05", { proof: true });
    await upload(event, "proof_photo_06", { proof: true });

    expect((await releaseAs({ id: owner }, event.id)).body.released).toBe(0);
    expect((await releaseAs(null, event.id)).status).toBe(401);

    const { body } = await releaseAs({ id: photographer }, event.id, { mediaIds: ["proof_photo_05"] });
    expect(body).toMatchObject({ released: 1, ids: ["proof_photo_05"], more: false });

    const [row] = await testDb.select().from(media).where(eq(media.id, "proof_photo_05"));
    expect(row).toMatchObject({ blobPathname: pathname, proofOriginalPathname: null, thumbPathname: null });
    expect(row.proofReleasedAt).not.toBeNull();
    expect(bucket.has(proofPathnameFor(event.id, "proof_photo_05"))).toBe(false);
    expect(bucket.has(pathname)).toBe(true);

    viewer.ownerSession = { user: { id: owner } };
    expect(await servedKey(content, event, "proof_photo_05")).toBe(pathname);
    // The other proof is still locked.
    expect(await servedKey(content, event, "proof_photo_06")).toBe(proofPathnameFor(event.id, "proof_photo_06"));

    const queued = await testDb.select().from(jobs).where(eq(jobs.kind, "media.backfill_thumbnails"));
    expect(queued).toHaveLength(1);
    const logged = await testDb.select().from(auditLog).where(and(eq(auditLog.action, "proofs.released"), eq(auditLog.eventId, event.id)));
    expect(logged[0]?.detail).toBe("1 proof");
  });

  it("lets a superadmin release a photographer's proofs, for one who has left", async () => {
    const { photographer, event } = await setup();
    viewer.ownerSession = { user: { id: photographer } };
    await upload(event, "proof_photo_07", { proof: true });
    const admin = await makeUser({ role: "superadmin" });
    expect((await releaseAs({ id: admin, role: "superadmin" }, event.id)).body.released).toBe(1);
  });
});

describe("MED-8 keeping camera details on the team's photos", () => {
  async function cameraJpeg() {
    return sharp({ create: { width: 120, height: 80, channels: 3, background: "#456" } })
      .withExif({
        IFD0: { Make: "Canon", Model: "EOS R5" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" },
      })
      .jpeg()
      .toBuffer();
  }

  async function sendAsShot(event: { id: string; slug: string }, mediaId: string) {
    const bytes = await cameraJpeg();
    const pathname = blobPathnameFor(event.id, mediaId, "jpg");
    bucket.set(pathname, bytes);
    const response = await register(
      post(`/api/e/${event.slug}/media`, { mediaId, pathname, mimeType: "image/jpeg", sizeBytes: bytes.length, clientCompressed: false }),
      { params: Promise.resolve({ slug: event.slug }) },
    );
    expect(response.status).toBe(201);
    return bucket.get(pathname)!;
  }

  it("keeps the camera and removes the location when the host has it on", async () => {
    const { owner, event } = await setup();
    await testDb.update(events).set({ keepPhotoDetails: true }).where(eq(events.id, event.id));
    const [fresh] = await testDb.select().from(events).where(eq(events.id, event.id));
    viewer.ownerSession = { user: { id: owner } };

    const stored = await sendAsShot(fresh, "keep_details_01");
    const exif = (await sharp(stored).metadata()).exif!;
    expect(exif.toString("latin1")).toContain("EOS R5");
    expect(stored.includes(Buffer.from([0x28, 0, 0, 0, 1, 0, 0, 0]))).toBe(false);
    const [row] = await testDb.select().from(media).where(eq(media.id, "keep_details_01"));
    expect([row.width, row.height]).toEqual([120, 80]);
  });

  it("re-encodes a guest's photo, and the team's when the setting is off, so nothing is kept", async () => {
    const { owner, event } = await setup();
    await testDb.update(events).set({ keepPhotoDetails: true }).where(eq(events.id, event.id));
    viewer.guestId = await makeGuest(event.id);
    const fromGuest = await sendAsShot(event, "keep_details_02");
    expect((await sharp(fromGuest).metadata()).exif).toBeUndefined();

    await testDb.update(events).set({ keepPhotoDetails: false }).where(eq(events.id, event.id));
    viewer.guestId = null;
    viewer.ownerSession = { user: { id: owner } };
    const offForTeam = await sendAsShot(event, "keep_details_03");
    expect((await sharp(offForTeam).metadata()).exif).toBeUndefined();
  });
});
