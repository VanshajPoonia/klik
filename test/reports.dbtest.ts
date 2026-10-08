import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const deleteBlobs = vi.fn(async (keys: string[]) => {
  void keys;
});
const sendEmail = vi.fn(async (message: { to: string }) => {
  void message;
  return { sent: true };
});
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  deleteBlobs,
}));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));

const { fileReport, resolveReports, releaseLegalHold, openReportCounts } = await import("@/lib/reports");
const { eraseEvent, eraseGuestUpload, LegalHoldError } = await import("@/lib/erasure");
const { createExport } = await import("@/lib/exports");
const { GET: purge } = await import("@/app/api/cron/purge-expired/route");
const { media, mediaExports } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const mediaRow = async (id: string) => (await testDb.select().from(media).where(eq(media.id, id)))[0];
const report = (eventId: string, mediaId: string, reason: "nudity" | "child_safety" | "spam", ip: string) =>
  fileReport({ eventId, mediaId, reason, reporter: { ip } });

beforeEach(async () => {
  deleteBlobs.mockClear();
  sendEmail.mockClear();
  process.env.ALERT_EMAIL = "ops@example.test";
  await resetDatabase();
});

afterAll(closeDatabase);

describe("fileReport", () => {
  it("records one report per person per photo, however often they press it", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    expect((await report(eventId, photo, "spam", "1.1.1.1"))?.created).toBe(true);
    expect((await report(eventId, photo, "spam", "1.1.1.1"))?.created).toBe(false);
    expect((await openReportCounts(eventId)).get(photo)).toBe(1);
  });

  it("hides a photo from guests once three different people report it", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    await report(eventId, photo, "nudity", "1.1.1.1");
    await report(eventId, photo, "nudity", "2.2.2.2");
    expect((await mediaRow(photo)).status).toBe("approved");
    const third = await report(eventId, photo, "nudity", "3.3.3.3");
    expect(third?.hidden).toBe(true);
    expect((await mediaRow(photo)).status).toBe("pending");
  });

  it("hides and holds a child-safety report at once, and alerts operations rather than the host", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    const result = await report(eventId, photo, "child_safety", "1.1.1.1");
    expect(result).toMatchObject({ hidden: true, held: true });
    const row = await mediaRow(photo);
    expect(row.status).toBe("rejected");
    expect(row.legalHoldAt).not.toBeNull();
    const recipients = sendEmail.mock.calls.map(([message]) => message.to);
    expect(recipients).toEqual(["ops@example.test"]);
  });

  it("refuses a photo that is gone", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId, { deletedAt: new Date() });
    expect(await report(eventId, photo, "spam", "1.1.1.1")).toBeNull();
  });
});

describe("a legal hold", () => {
  it("stops the uploader deleting it", async () => {
    const eventId = await makeEvent(await makeUser());
    const guest = await makeGuest(eventId);
    const photo = await makeMedia(eventId, { guestId: guest });
    await report(eventId, photo, "child_safety", "1.1.1.1");
    expect(await eraseGuestUpload(guest, eventId, photo)).toBeNull();
    expect(await mediaRow(photo)).toBeDefined();
  });

  it("stops an erasure request, which the law does not let override it", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const photo = await makeMedia(eventId);
    await report(eventId, photo, "child_safety", "1.1.1.1");
    await expect(eraseEvent(eventId, owner, "test")).rejects.toBeInstanceOf(LegalHoldError);
    expect(deleteBlobs).not.toHaveBeenCalled();
  });

  it("stops the 30-day purge destroying it, even in the trash", async () => {
    const eventId = await makeEvent(await makeUser());
    const held = await makeMedia(eventId);
    const plain = await makeMedia(eventId);
    await report(eventId, held, "child_safety", "1.1.1.1");
    await testDb.execute(sql`UPDATE media SET deleted_at = now() - interval '40 days'`);

    await purge(new Request("https://klik.test/api/cron/purge-expired", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));

    expect(await mediaRow(held)).toBeDefined();
    expect(await mediaRow(plain)).toBeUndefined();
  });

  it("lifts only when a superadmin releases it", async () => {
    const eventId = await makeEvent(await makeUser());
    const photo = await makeMedia(eventId);
    await report(eventId, photo, "child_safety", "1.1.1.1");
    expect(await releaseLegalHold(photo)).toBe(true);
    expect((await mediaRow(photo)).legalHoldAt).toBeNull();
  });
});

describe("resolveReports", () => {
  it("closes every open report on the photo", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const photo = await makeMedia(eventId);
    await report(eventId, photo, "spam", "1.1.1.1");
    await report(eventId, photo, "spam", "2.2.2.2");
    expect(await resolveReports(photo, { byUserId: owner, resolution: "Kept" })).toBe(2);
    expect((await openReportCounts(eventId)).get(photo)).toBeUndefined();
  });
});

describe("eraseGuestUpload (MED-6)", () => {
  it("erases the guest's own upload outright, bytes first, not into the host's trash", async () => {
    const eventId = await makeEvent(await makeUser());
    const guest = await makeGuest(eventId);
    const photo = await makeMedia(eventId, { guestId: guest, thumbPathname: "events/x/t.jpg" });
    const result = await eraseGuestUpload(guest, eventId, photo);
    expect(result).toMatchObject({ mediaDeleted: 1 });
    expect(await mediaRow(photo)).toBeUndefined();
    expect(deleteBlobs.mock.calls[0][0]).toEqual(expect.arrayContaining(["events/x/t.jpg"]));
  });

  it("will not touch somebody else's upload", async () => {
    const eventId = await makeEvent(await makeUser());
    const mine = await makeGuest(eventId);
    const theirs = await makeGuest(eventId);
    const photo = await makeMedia(eventId, { guestId: theirs });
    expect(await eraseGuestUpload(mine, eventId, photo)).toBeNull();
    expect(await mediaRow(photo)).toBeDefined();
  });

  it("removes the prepared downloads that contained it, and only those", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const guest = await makeGuest(eventId);
    const photo = await makeMedia(eventId, { guestId: guest });
    const other = await makeMedia(eventId);
    await createExport({ eventId, requestedByUserId: owner, label: "All", items: [{ id: photo, sizeBytes: 1 }, { id: other, sizeBytes: 1 }] });
    await createExport({ eventId, requestedByUserId: owner, label: "Other", items: [{ id: other, sizeBytes: 1 }] });
    await eraseGuestUpload(guest, eventId, photo);
    expect((await testDb.select().from(mediaExports)).map((row) => row.label)).toEqual(["Other"]);
  });
});
