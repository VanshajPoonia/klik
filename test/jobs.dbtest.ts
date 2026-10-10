import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const reapOrphans = vi.fn();

// The queue's SQL is what is under test, so `db` is a real local Postgres. The
// one handler is replaced with a spy: its own logic has its own tests, and here
// it only needs to succeed, fail or ask for a requeue on command.
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/job-handlers/reap-orphans", () => ({ reapOrphans }));

const { enqueue, scheduleDailyJobs } = await import("@/lib/jobs");
const { claimJobs, drainJobs, pruneFinishedJobs, runClaimedJob } = await import("@/lib/job-runner");
const { jobs } = await import("@/lib/schema");
const { closeDatabase, resetDatabase, testDb } = await import("./harness");

const getJob = async (id: string) => (await testDb.select().from(jobs).where(eq(jobs.id, id)))[0];
const farFuture = () => Date.now() + 60_000;

beforeEach(async () => {
  reapOrphans.mockReset();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("enqueue", () => {
  it("collapses a duplicate while the first is still live", async () => {
    const first = await enqueue("uploads.reap_orphans", {}, { dedupeKey: "k" });
    const second = await enqueue("uploads.reap_orphans", {}, { dedupeKey: "k" });
    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(await testDb.select().from(jobs)).toHaveLength(1);
  });

  it("allows the same key again once the first has finished", async () => {
    const first = await enqueue("uploads.reap_orphans", {}, { dedupeKey: "k" });
    await testDb.update(jobs).set({ status: "succeeded" }).where(eq(jobs.id, first.id));
    expect((await enqueue("uploads.reap_orphans", {}, { dedupeKey: "k" })).enqueued).toBe(true);
  });

  it("never dedupes jobs that have no key", async () => {
    await enqueue("uploads.reap_orphans", {});
    await enqueue("uploads.reap_orphans", {});
    expect(await testDb.select().from(jobs)).toHaveLength(2);
  });

  it("refuses a payload that does not match its kind", async () => {
    await expect(
      enqueue("uploads.reap_orphans", { scanned: -1 } as never),
    ).rejects.toThrow();
  });
});

describe("claimJobs", () => {
  it("hands one job to exactly one of many concurrent claimers", async () => {
    // The property the whole queue rests on. neon-http has no transactions, so
    // this has to hold inside a single statement, which is what SKIP LOCKED
    // inside the UPDATE's subquery gives.
    await enqueue("uploads.reap_orphans", {});
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => claimJobs(`worker_${index}`, 1)),
    );
    expect(results.flat()).toHaveLength(1);
  });

  it("does not claim work that is not due yet", async () => {
    await enqueue("uploads.reap_orphans", {}, { runAfter: new Date(Date.now() + 60_000) });
    expect(await claimJobs("w", 5)).toHaveLength(0);
  });

  it("reclaims a job a killed function left running, and counts the attempt", async () => {
    const { id } = await enqueue("uploads.reap_orphans", {});
    await claimJobs("killed", 1);
    await testDb
      .update(jobs)
      .set({ lockedAt: sql`now() - interval '16 minutes'` })
      .where(eq(jobs.id, id));

    const [reclaimed] = await claimJobs("rescuer", 1);
    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.lockedBy).toBe("rescuer");
    expect(reclaimed?.attempts).toBe(2);
  });

  it("leaves a recently locked job alone", async () => {
    await enqueue("uploads.reap_orphans", {});
    await claimJobs("busy", 1);
    expect(await claimJobs("other", 1)).toHaveLength(0);
  });
});

describe("runClaimedJob", () => {
  it("marks a job that returns cleanly as succeeded", async () => {
    reapOrphans.mockResolvedValue(undefined);
    const { id } = await enqueue("uploads.reap_orphans", {});
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    const row = await getJob(id);
    expect(row.status).toBe("succeeded");
    expect(row.finishedAt).not.toBeNull();
  });

  it("schedules a retry with backoff when a job throws", async () => {
    reapOrphans.mockRejectedValue(new Error("R2 was down"));
    const { id } = await enqueue("uploads.reap_orphans", {});
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    const row = await getJob(id);
    expect(row.status).toBe("queued");
    expect(row.lastError).toContain("R2 was down");
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now() + 15_000);
    expect(row.lockedBy).toBeNull();
  });

  it("gives up into dead on the final attempt", async () => {
    reapOrphans.mockRejectedValue(new Error("still down"));
    const { id } = await enqueue("uploads.reap_orphans", {}, { maxAttempts: 1 });
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    const row = await getJob(id);
    expect(row.status).toBe("dead");
    expect(row.lastError).toContain("still down");
  });

  it("does not spend an attempt when a handler asks to continue later", async () => {
    reapOrphans.mockResolvedValue({ requeue: { payload: { continuationToken: "page-2" } } });
    const { id } = await enqueue("uploads.reap_orphans", {});
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    const row = await getJob(id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.payload).toEqual({ continuationToken: "page-2" });
  });

  it("cannot overwrite the outcome after its job was reclaimed by someone else", async () => {
    reapOrphans.mockResolvedValue(undefined);
    const { id } = await enqueue("uploads.reap_orphans", {});
    const [job] = await claimJobs("slow", 1);
    // Another worker took it over as stale while the slow one was still going.
    await testDb.update(jobs).set({ lockedBy: "rescuer" }).where(eq(jobs.id, id));
    await runClaimedJob(job, "slow", farFuture());
    expect((await getJob(id)).status).toBe("running");
  });

  it("hands back a job of a kind this deployment does not know, during a rollout", async () => {
    await testDb.insert(jobs).values({ id: "future", kind: "from.a.newer.deploy", payload: {} });
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    const row = await getJob("future");
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
  });

  it("kills a job with a malformed payload without retrying it", async () => {
    await testDb.insert(jobs).values({ id: "bad", kind: "uploads.reap_orphans", payload: { scanned: "lots" } });
    const [job] = await claimJobs("w", 1);
    await runClaimedJob(job, "w", farFuture());
    expect((await getJob("bad")).status).toBe("dead");
    expect(reapOrphans).not.toHaveBeenCalled();
  });
});

describe("drainJobs", () => {
  it("runs everything due and reports that the queue is empty", async () => {
    reapOrphans.mockResolvedValue(undefined);
    await enqueue("uploads.reap_orphans", {});
    await enqueue("uploads.reap_orphans", {});
    const result = await drainJobs({ budgetMs: 60_000 });
    expect(result).toMatchObject({ ran: 2, stoppedBecause: "empty" });
  });

  it("starts nothing when the budget leaves no room to finish", async () => {
    await enqueue("uploads.reap_orphans", {});
    const result = await drainJobs({ budgetMs: 0 });
    expect(result).toMatchObject({ ran: 0, stoppedBecause: "budget" });
    expect(reapOrphans).not.toHaveBeenCalled();
  });
});

describe("scheduleDailyJobs", () => {
  it("schedules each daily job once per day however often it is called", async () => {
    const daily = [
      "uploads.reap_orphans",
      "media.backfill_thumbnails",
      "entitlements.reconcile",
      "exports.expire",
      "notify.retention",
      "usage.reconcile",
      "media.backfill_video_scrubs",
      "moments.backfill",
      "media.backfill_analysis",
    ];
    const morning = new Date("2026-10-08T04:00:00Z");
    expect(await scheduleDailyJobs(morning)).toEqual(daily);
    // Even after the first one has finished, which the live-only dedupe index
    // would not catch on its own.
    await testDb.update(jobs).set({ status: "succeeded" });
    expect(await scheduleDailyJobs(new Date("2026-10-08T23:59:00Z"))).toEqual([]);
    expect(await scheduleDailyJobs(new Date("2026-10-09T00:01:00Z"))).toEqual(daily);
  });
});

describe("pruneFinishedJobs", () => {
  it("keeps recent history and dead jobs for longer than successes", async () => {
    await testDb.insert(jobs).values([
      { id: "old_ok", kind: "k", status: "succeeded", finishedAt: sql`now() - interval '8 days'` },
      { id: "new_ok", kind: "k", status: "succeeded", finishedAt: sql`now() - interval '1 day'` },
      { id: "old_dead", kind: "k", status: "dead", finishedAt: sql`now() - interval '8 days'` },
      { id: "ancient_dead", kind: "k", status: "dead", finishedAt: sql`now() - interval '31 days'` },
    ]);
    expect(await pruneFinishedJobs()).toBe(2);
    const left = (await testDb.select({ id: jobs.id }).from(jobs)).map((row) => row.id).sort();
    expect(left).toEqual(["new_ok", "old_dead"]);
  });
});
