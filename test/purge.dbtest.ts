import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

const deleteBlobs = vi.fn(async (pathnames: string[]) => {
  void pathnames;
});

// The route imports `db` and `deleteBlobs` directly, so both are replaced at
// the module boundary: the database with a real local Postgres, and R2 with a
// spy. The queries are the thing under test; the object store is not.
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  deleteBlobs,
  // Listings of an event's exports and designs find nothing here.
  r2: { send: async () => ({ Contents: [], IsTruncated: false }) },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const { GET } = await import("@/app/api/cron/purge-expired/route");
const { events, jobs, media } = await import("@/lib/schema");
const { purgeDeletedEvent } = await import("@/lib/purge");
const {
  closeDatabase,
  daysFromNow,
  makeEvent,
  makeMedia,
  makeUser,
  resetDatabase,
  testDb,
} = await import("./harness");

const CRON_SECRET = process.env.CRON_SECRET!;

const runCron = (secret = CRON_SECRET) =>
  GET(
    new Request("https://klik.test/api/cron/purge-expired", {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

beforeEach(async () => {
  deleteBlobs.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("authorization", () => {
  it("refuses a request with no secret", async () => {
    const response = await GET(new Request("https://klik.test/api/cron/purge-expired"));
    expect(response.status).toBe(401);
  });

  it("refuses a wrong secret", async () => {
    expect((await runCron("not-the-secret")).status).toBe(401);
  });
});

describe("the circuit breaker", () => {
  /**
   * SEC-1, and the reason this file exists.
   *
   * The failure it guards against is not a bug in this route. It is a bad
   * migration, or a plan change, that makes every gallery on the platform
   * eligible at once. Deleting a few galleries a night is a backlog. Deleting
   * most of them is a configuration error, and the only safe response is to
   * stop and shout.
   */
  it("aborts and deletes nothing when most of the platform is suddenly eligible", async () => {
    const owner = await makeUser();
    // 40 expired out of 50 total: over the 25 count threshold and over the
    // half-the-platform ratio, so both conditions hold.
    for (let i = 0; i < 40; i += 1) {
      const id = await makeEvent(owner, { retentionUntil: daysFromNow(-1) });
      await makeMedia(id);
    }
    for (let i = 0; i < 10; i += 1) {
      await makeEvent(owner, { retentionUntil: daysFromNow(365) });
    }

    const response = await runCron();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ eligible: 40, total: 50 });

    // The important assertion: nothing was touched on the way to aborting.
    const purged = await testDb.select().from(events).where(isNotNull(events.purgedAt));
    expect(purged).toHaveLength(0);
    const softDeleted = await testDb.select().from(media).where(isNotNull(media.deletedAt));
    expect(softDeleted).toHaveLength(0);
  });

  it("does not abort on a large platform with a small backlog", async () => {
    const owner = await makeUser();
    // 30 expired, which is over the count threshold, but out of 200 events, so
    // the ratio check saves it. Both conditions are required, not either.
    for (let i = 0; i < 30; i += 1) {
      await makeEvent(owner, { retentionUntil: daysFromNow(-1) });
    }
    for (let i = 0; i < 170; i += 1) {
      await makeEvent(owner, { retentionUntil: daysFromNow(365) });
    }

    const response = await runCron();
    expect(response.status).toBe(200);
    // Capped at MAX_PURGES_PER_RUN rather than doing all 30 at once.
    await expect(response.json()).resolves.toMatchObject({ eventsPurged: 25 });
  });

  it("does not abort on a small platform where everything is genuinely expired", async () => {
    const owner = await makeUser();
    // 5 of 5 expired is 100% of the platform, but under the count threshold,
    // which is what stops a brand new install tripping the breaker on day one.
    for (let i = 0; i < 5; i += 1) {
      await makeEvent(owner, { retentionUntil: daysFromNow(-1) });
    }

    expect((await runCron()).status).toBe(200);
    const purged = await testDb.select().from(events).where(isNotNull(events.purgedAt));
    expect(purged).toHaveLength(5);
  });
});

describe("retention", () => {
  /**
   * The original SEC-1 bug in one assertion. Retention used to be resolved from
   * the mutable `users.plan_key`, and `getPlan()` falls back to the shortest
   * window for an unknown key, so a typo could set every gallery to the minimum
   * and delete it. Null now means "we do not know", and "we do not know" must
   * never resolve to "delete it".
   */
  it("skips events with no retention deadline rather than defaulting one", async () => {
    const owner = await makeUser();
    const noDeadline = await makeEvent(owner, { retentionUntil: null });
    await makeMedia(noDeadline);

    expect((await runCron()).status).toBe(200);

    const [row] = await testDb.select().from(events).where(eq(events.id, noDeadline));
    expect(row.purgedAt).toBeNull();
    const photos = await testDb.select().from(media).where(eq(media.eventId, noDeadline));
    expect(photos[0].deletedAt).toBeNull();
  });

  it("soft-deletes an expired gallery instead of destroying it", async () => {
    const owner = await makeUser();
    const expired = await makeEvent(owner, { retentionUntil: daysFromNow(-1) });
    const photo = await makeMedia(expired);

    expect((await runCron()).status).toBe(200);

    // The gallery empties, which is the promised outcome, but the row and the
    // bytes both survive the usual 30 day grace. Reaching a deadline at 3am is
    // a bad way to discover a retention window was miscalculated.
    const [row] = await testDb.select().from(media).where(eq(media.id, photo));
    expect(row.deletedAt).not.toBeNull();
    expect(deleteBlobs).not.toHaveBeenCalled();

    const [event] = await testDb.select().from(events).where(eq(events.id, expired));
    expect(event.purgedAt).not.toBeNull();
    expect(event.isActive).toBe(false);
    expect(event.uploadsEnabled).toBe(false);
  });

  it("leaves a gallery that has not reached its deadline completely alone", async () => {
    const owner = await makeUser();
    const live = await makeEvent(owner, { retentionUntil: daysFromNow(30) });
    await makeMedia(live);

    expect((await runCron()).status).toBe(200);

    const [event] = await testDb.select().from(events).where(eq(events.id, live));
    expect(event.purgedAt).toBeNull();
    expect(event.isActive).toBe(true);
  });
});

describe("the trash window", () => {
  it("destroys media soft-deleted more than 30 days ago, bytes included", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner, { retentionUntil: daysFromNow(365) });
    const old = await makeMedia(event, {
      deletedAt: daysFromNow(-31),
      posterPathname: `events/${event}/poster.jpg`,
    });

    expect((await runCron()).status).toBe(200);

    const rows = await testDb.select().from(media).where(eq(media.id, old));
    expect(rows).toHaveLength(0);

    // Rows before bytes, and the poster named explicitly, or a thumbnail
    // outlives the video it described.
    expect(deleteBlobs).toHaveBeenCalledOnce();
    const deleted = deleteBlobs.mock.calls[0][0];
    expect(deleted).toContain(`events/${event}/${old}.jpg`);
    expect(deleted).toContain(`events/${event}/poster.jpg`);
  });

  it("keeps media still inside its 30 day recovery window", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner, { retentionUntil: daysFromNow(365) });
    const recent = await makeMedia(event, { deletedAt: daysFromNow(-29) });

    expect((await runCron()).status).toBe(200);

    const rows = await testDb.select().from(media).where(eq(media.id, recent));
    expect(rows).toHaveLength(1);
    expect(deleteBlobs).not.toHaveBeenCalled();
  });

  it("never touches media that was never deleted", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner, { retentionUntil: daysFromNow(365) });
    await makeMedia(event);

    expect((await runCron()).status).toBe(200);

    const live = await testDb
      .select()
      .from(media)
      .where(and(eq(media.eventId, event), isNull(media.deletedAt)));
    expect(live).toHaveLength(1);
  });
});

describe("SEC-5 deleted events, one job each", () => {
  it("queues one job per event past its 30 days, once, and the job erases it, bytes included", async () => {
    const owner = await makeUser();
    const old = await makeEvent(owner, { deletedAt: daysFromNow(-31) });
    const recent = await makeEvent(owner, { deletedAt: daysFromNow(-5) });
    await makeMedia(old, { blobPathname: "events/old/a.jpg" });

    expect((await runCron()).status).toBe(200);
    expect((await runCron()).status).toBe(200);
    const queued = await testDb.select().from(jobs).where(eq(jobs.kind, "events.purge_deleted"));
    expect(queued.map((job) => (job.payload as { eventId: string }).eventId)).toEqual([old]);

    expect(await purgeDeletedEvent(old)).toBe("purged");
    expect(await testDb.select().from(events).where(eq(events.id, old))).toHaveLength(0);
    expect(deleteBlobs).toHaveBeenCalledWith(expect.arrayContaining(["events/old/a.jpg"]));

    // Run again, or on one still inside its window: nothing to do.
    expect(await purgeDeletedEvent(old)).toBe("skipped");
    expect(await purgeDeletedEvent(recent)).toBe("skipped");
    expect(await testDb.select().from(events).where(eq(events.id, recent))).toHaveLength(1);
  });

  it("leaves an event alone while anything in it is under a legal hold", async () => {
    const eventId = await makeEvent(await makeUser(), { deletedAt: daysFromNow(-40) });
    await makeMedia(eventId, { legalHoldAt: new Date() });
    expect(await purgeDeletedEvent(eventId)).toBe("skipped");
    expect(await testDb.select().from(events).where(eq(events.id, eventId))).toHaveLength(1);
  });
});
