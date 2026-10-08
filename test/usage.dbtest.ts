import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const sendEmail = vi.fn(async (message: { to: string; subject: string }) => {
  void message;
  return { sent: true };
});
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));

const { claimUsageWarning, reconcileUsage, retentionThreshold, sendRetentionWarnings } = await import("@/lib/notices");
const { events, media } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const GB = 1024 ** 3;
const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];

beforeEach(async () => {
  sendEmail.mockClear();
  await resetDatabase();
});
afterAll(closeDatabase);

describe("the usage triggers", () => {
  it("follow uploads, soft deletes, restores and purges", async () => {
    const eventId = await makeEvent(await makeUser());
    const a = await makeMedia(eventId, { sizeBytes: 100 });
    await makeMedia(eventId, { sizeBytes: 50 });
    expect(await eventRow(eventId)).toMatchObject({ mediaCount: 2, mediaBytes: 150 });

    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, a));
    expect(await eventRow(eventId)).toMatchObject({ mediaCount: 1, mediaBytes: 50 });

    await testDb.update(media).set({ deletedAt: null }).where(eq(media.id, a));
    expect(await eventRow(eventId)).toMatchObject({ mediaCount: 2, mediaBytes: 150 });

    // The server re-encodes a photo and its size changes.
    await testDb.update(media).set({ sizeBytes: 40 }).where(eq(media.id, a));
    expect((await eventRow(eventId)).mediaBytes).toBe(90);

    // Purging something already in the trash changes nothing visible.
    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, a));
    await testDb.delete(media).where(eq(media.id, a));
    expect(await eventRow(eventId)).toMatchObject({ mediaCount: 1, mediaBytes: 50 });
  });

  it("are healed by the nightly reconcile when something drifts", async () => {
    const eventId = await makeEvent(await makeUser());
    await makeMedia(eventId, { sizeBytes: 70 });
    await testDb.update(events).set({ mediaCount: 99, mediaBytes: 1 }).where(eq(events.id, eventId));
    expect(await reconcileUsage()).toBe(1);
    expect(await eventRow(eventId)).toMatchObject({ mediaCount: 1, mediaBytes: 70 });
  });
});

describe("claimUsageWarning", () => {
  it("claims each threshold once, even when asked twice", async () => {
    const eventId = await makeEvent(await makeUser(), { planKey: "event", licensedAt: new Date() });
    await makeMedia(eventId, { sizeBytes: 20 * GB });
    expect(await claimUsageWarning(eventId)).toBe(75);
    expect(await claimUsageWarning(eventId)).toBeNull();
    await makeMedia(eventId, { sizeBytes: 3 * GB });
    expect(await claimUsageWarning(eventId)).toBe(90);
  });

  it("says nothing below 75 percent", async () => {
    const eventId = await makeEvent(await makeUser(), { planKey: "event", licensedAt: new Date() });
    await makeMedia(eventId, { sizeBytes: GB });
    expect(await claimUsageWarning(eventId)).toBeNull();
  });
});

describe("retention warnings", () => {
  it("picks the nearest of 30, 7 and 1 days", () => {
    expect(retentionThreshold(31)).toBeNull();
    expect(retentionThreshold(30)).toBe(30);
    expect(retentionThreshold(8)).toBe(30);
    expect(retentionThreshold(7)).toBe(7);
    expect(retentionThreshold(1)).toBe(1);
  });

  it("warns once per threshold, and again as the date comes closer", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, {
      licensedAt: new Date(),
      retentionUntil: sql`now() + interval '20 days'` as unknown as Date,
    });
    expect((await sendRetentionWarnings()).sent).toBe(1);
    expect((await sendRetentionWarnings()).sent).toBe(0);
    await testDb.execute(sql`UPDATE events SET retention_until = now() + interval '5 days' WHERE id = ${eventId}`);
    expect((await sendRetentionWarnings()).sent).toBe(1);
    expect((await eventRow(eventId)).retentionWarnedDays).toBe(7);
  });

  it("starts over when the window moves out, so the new date gets its own warnings", async () => {
    const eventId = await makeEvent(await makeUser(), {
      licensedAt: new Date(),
      retentionUntil: sql`now() + interval '20 days'` as unknown as Date,
    });
    await sendRetentionWarnings();
    await testDb.execute(sql`UPDATE events SET retention_until = now() + interval '200 days' WHERE id = ${eventId}`);
    expect((await sendRetentionWarnings()).reset).toBe(1);
    expect((await eventRow(eventId)).retentionWarnedDays).toBeNull();
  });

  it("never warns about a draft, which has no window running", async () => {
    await makeEvent(await makeUser(), { retentionUntil: sql`now() + interval '5 days'` as unknown as Date });
    expect((await sendRetentionWarnings()).sent).toBe(0);
  });
});
