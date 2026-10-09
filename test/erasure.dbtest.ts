import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

const deleteBlobs = vi.fn(async (pathnames: string[]) => {
  void pathnames;
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  deleteBlobs,
}));

const { eraseEvent, eraseGuest, eraseGuestUpload, eraseUser } = await import("@/lib/erasure");
const { erasureLog, events, guests, media, users } = await import("@/lib/schema");
const {
  closeDatabase,
  daysFromNow,
  makeEvent,
  makeGuest,
  makeMedia,
  makeUser,
  resetDatabase,
  testDb,
} = await import("./harness");

beforeEach(async () => {
  deleteBlobs.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

const blobsPassedTo = () => deleteBlobs.mock.calls.flatMap((call) => call[0]);

describe("eraseEvent", () => {
  it("removes the event, its media, its guests and its objects", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const guest = await makeGuest(event);
    const photo = await makeMedia(event, { guestId: guest, sizeBytes: 2048 });

    const result = await eraseEvent(event, owner);

    expect(result).toEqual({ mediaDeleted: 1, bytesDeleted: 2048 });
    expect(await testDb.select().from(events).where(eq(events.id, event))).toHaveLength(0);
    expect(await testDb.select().from(media).where(eq(media.id, photo))).toHaveLength(0);
    expect(await testDb.select().from(guests).where(eq(guests.id, guest))).toHaveLength(0);
    expect(blobsPassedTo()).toContain(`events/${event}/${photo}.jpg`);
  });

  /**
   * The failure this guards against: soft delete is the normal path, so by the
   * time someone demands erasure a chunk of their uploads are already sitting
   * in the trash with `deleted_at` set. A query that filters those out the way
   * every *user-facing* query must would leave exactly the data the request was
   * about.
   */
  it("includes media that was already in the trash", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const live = await makeMedia(event);
    const trashed = await makeMedia(event, { deletedAt: daysFromNow(-2) });

    const result = await eraseEvent(event, owner);

    expect(result.mediaDeleted).toBe(2);
    const blobs = blobsPassedTo();
    expect(blobs).toContain(`events/${event}/${live}.jpg`);
    expect(blobs).toContain(`events/${event}/${trashed}.jpg`);
  });

  it("names video posters explicitly, since R2 has no cascade", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const clip = await makeMedia(event, {
      kind: "video",
      mimeType: "video/mp4",
      posterPathname: `events/${event}/poster.jpg`,
    });

    await eraseEvent(event, owner);

    const blobs = blobsPassedTo();
    expect(blobs).toContain(`events/${event}/${clip}.jpg`);
    expect(blobs).toContain(`events/${event}/poster.jpg`);
  });

  /**
   * Bytes before rows, the opposite order to the purge cron. The failure
   * erasure must never produce is telling someone their data is gone while it
   * is still in the bucket, so a failed object delete has to leave the rows
   * intact and let a retry find them again.
   */
  it("leaves the rows intact when the object delete fails", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const photo = await makeMedia(event);
    deleteBlobs.mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(eraseEvent(event, owner)).rejects.toThrow("R2 unavailable");

    expect(await testDb.select().from(media).where(eq(media.id, photo))).toHaveLength(1);
    expect(await testDb.select().from(events).where(eq(events.id, event))).toHaveLength(1);
    // And nothing was logged, so the log never claims an erasure that did not happen.
    expect(await testDb.select().from(erasureLog)).toHaveLength(0);
  });
});

describe("eraseGuest", () => {
  it("removes only that guest's uploads and leaves the event standing", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const leaving = await makeGuest(event);
    const staying = await makeGuest(event);
    const theirs = await makeMedia(event, { guestId: leaving });
    const other = await makeMedia(event, { guestId: staying });

    const result = await eraseGuest(leaving, event, owner);

    expect(result.mediaDeleted).toBe(1);
    expect(await testDb.select().from(media).where(eq(media.id, theirs))).toHaveLength(0);
    expect(await testDb.select().from(media).where(eq(media.id, other))).toHaveLength(1);
    expect(await testDb.select().from(guests).where(eq(guests.id, staying))).toHaveLength(1);
    expect(await testDb.select().from(events).where(eq(events.id, event))).toHaveLength(1);
  });

  it("clears a cover photo that pointed at the erased upload", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const guest = await makeGuest(event);
    const cover = await makeMedia(event, { guestId: guest });
    await testDb.update(events).set({ coverMediaId: cover }).where(eq(events.id, event));

    await eraseGuest(guest, event, owner);

    const [row] = await testDb.select().from(events).where(eq(events.id, event));
    expect(row.coverMediaId).toBeNull();
  });
});

describe("edited copies (CAM-2)", () => {
  const remaining = async (eventId: string) =>
    (await testDb.select({ id: media.id }).from(media).where(eq(media.eventId, eventId))).map((row) => row.id).sort();

  it("go with the guest's photo when they delete it, the host's copy and a copy of that included", async () => {
    const event = await makeEvent(await makeUser());
    const guest = await makeGuest(event);
    const photo = await makeMedia(event, { guestId: guest });
    const hostsCopy = await makeMedia(event, { derivedFromId: photo });
    const copyOfCopy = await makeMedia(event, { derivedFromId: hostsCopy });
    const unrelated = await makeMedia(event);

    const result = await eraseGuestUpload(guest, event, photo);
    expect(result?.mediaDeleted).toBe(3);
    expect(await remaining(event)).toEqual([unrelated]);
    void copyOfCopy;
  });

  it("go with everything a guest added when they remove it all", async () => {
    const event = await makeEvent(await makeUser());
    const guest = await makeGuest(event);
    const photo = await makeMedia(event, { guestId: guest });
    await makeMedia(event, { derivedFromId: photo, deletedAt: new Date() });
    const unrelated = await makeMedia(event);

    expect((await eraseGuest(guest, event, null)).mediaDeleted).toBe(2);
    expect(await remaining(event)).toEqual([unrelated]);
  });
});

describe("eraseUser", () => {
  /**
   * The foreign keys cascade on the database side, but R2 knows nothing about
   * foreign keys. If the objects are not collected before the account row goes,
   * the bytes outlive the account that owned them with nothing left pointing
   * at them, which is unbillable storage and an unfulfilled erasure at once.
   */
  it("collects objects across every owned event before the cascade removes the rows", async () => {
    const owner = await makeUser();
    const first = await makeEvent(owner);
    const second = await makeEvent(owner);
    const a = await makeMedia(first, { sizeBytes: 1000 });
    const b = await makeMedia(second, { sizeBytes: 500 });

    const result = await eraseUser(owner, null);

    expect(result).toEqual({ mediaDeleted: 2, bytesDeleted: 1500 });
    const blobs = blobsPassedTo();
    expect(blobs).toContain(`events/${first}/${a}.jpg`);
    expect(blobs).toContain(`events/${second}/${b}.jpg`);
    expect(await testDb.select().from(users).where(eq(users.id, owner))).toHaveLength(0);
    expect(await testDb.select().from(events).where(eq(events.ownerId, owner))).toHaveLength(0);
  });

  it("does not touch another account's events", async () => {
    const leaving = await makeUser();
    const staying = await makeUser();
    await makeEvent(leaving);
    const kept = await makeEvent(staying);
    await makeMedia(kept);

    await eraseUser(leaving, null);

    expect(await testDb.select().from(events).where(eq(events.id, kept))).toHaveLength(1);
    expect(blobsPassedTo()).not.toContain(`events/${kept}`);
  });
});

describe("the erasure log", () => {
  /**
   * The log proves an erasure happened. Proving that does not require keeping a
   * pointer to the person who asked, and storing the raw id would recreate, in
   * the audit trail, exactly the record the request was meant to remove.
   */
  it("stores a hash of the subject and never the identifier itself", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    await makeMedia(event, { sizeBytes: 4096 });

    await eraseEvent(event, owner, "right_to_be_forgotten");

    const [entry] = await testDb.select().from(erasureLog);
    expect(entry.subjectType).toBe("event");
    expect(entry.subjectHash).toBe(createHash("sha256").update(event).digest("hex"));
    expect(entry.subjectHash).not.toContain(event);
    expect(entry.mediaDeleted).toBe(1);
    expect(Number(entry.bytesDeleted)).toBe(4096);
    expect(entry.reason).toBe("right_to_be_forgotten");
  });
});
