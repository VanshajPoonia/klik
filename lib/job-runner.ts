import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { JOB_PAYLOADS, isJobKind, type JobKind, type JobPayload } from "./jobs";
import { jobs, type Job } from "./schema";
import { log, reportError } from "./observability";

/**
 * F-5: the background job queue, run side.
 *
 * A job is claimed with one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 * LOCKED)` statement. That matters on `neon-http`, which has no transactions:
 * the lock and the status change happen inside the single statement's implicit
 * transaction, so two drainers running at once can never both claim the same
 * row. `test/jobs.dbtest.ts` fires concurrent claims at one job to prove it.
 */

export interface JobContext {
  jobId: string;
  /** 1 on the first run. */
  attempt: number;
  /** When `attempt` reaches this, a throw is final and the job goes to dead. */
  maxAttempts: number;
  /** Epoch ms by which the handler should have returned. */
  deadline: number;
}

/**
 * A handler finishes by returning nothing. It may instead ask to be run again,
 * which is how long work is split across invocations: the orphan reaper walks a
 * bucket page by page and hands back its continuation token when time runs low.
 * A requeue is progress, not failure, so it does not use up an attempt.
 */
export type JobOutcome = void | { requeue: { payload?: Record<string, unknown>; delayMs?: number } };

type Handler<K extends JobKind> = (payload: JobPayload<K>, context: JobContext) => Promise<JobOutcome>;

/**
 * Loaded on demand, so draining the queue for a thumbnail does not also load
 * the S3 listing code, and a route that only enqueues loads none of it.
 */
const HANDLERS: { [K in JobKind]: () => Promise<Handler<K>> } = {
  "uploads.reap_orphans": async () => (await import("./job-handlers/reap-orphans")).reapOrphans,
  "media.thumbnail": async () => (await import("./job-handlers/thumbnail")).generateThumbnail,
  "media.backfill_thumbnails": async () => (await import("./job-handlers/thumbnail")).backfillThumbnails,
  "entitlements.reconcile": async () => async () => {
    await (await import("./entitlements")).reconcileLicenses();
  },
  "export.part": async () => (await import("./job-handlers/export")).buildExportPart,
  "exports.expire": async () => async () => {
    await (await import("./exports")).expireExports();
  },
  "notify.usage": async () => async (payload) => {
    await (await import("./notices")).sendUsageWarning(payload.eventId, payload.level);
  },
  "notify.retention": async () => async () => {
    await (await import("./notices")).sendRetentionWarnings();
  },
  "usage.reconcile": async () => async () => {
    await (await import("./notices")).reconcileUsage();
  },
  "media.scrub_video": async () => (await import("./job-handlers/video-scrub")).scrubVideo,
  "media.backfill_video_scrubs": async () => (await import("./job-handlers/video-scrub")).backfillVideoScrubs,
  "moments.refresh": async () => (await import("./job-handlers/moments")).refreshMoments,
  "moments.backfill": async () => (await import("./job-handlers/moments")).backfillMoments,
  "media.analyze": async () => (await import("./job-handlers/analyze")).analyzeMedia,
  "media.backfill_analysis": async () => (await import("./job-handlers/analyze")).backfillAnalysis,
  "recap.send": async () => (await import("./job-handlers/recap")).sendRecaps,
  "recap.backfill": async () => (await import("./job-handlers/recap")).backfillRecaps,
  "events.purge_deleted": async () => async (payload) => {
    await (await import("./purge")).purgeDeletedEvent(payload.eventId);
  },
  "notify.grace": async () => async (payload) => {
    await (await import("./billing-grace")).sendGraceNotice(payload);
  },
};

/** How long a job may sit in `running` before it is presumed killed. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

/**
 * 30 seconds, 2 minutes, 8, 32, then capped at six hours, each with up to 20
 * percent jitter so a batch that failed together does not retry together.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = BASE_RETRY_MS * 4 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, MAX_RETRY_MS);
  return Math.round(capped * (0.8 + random() * 0.4));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, 2000);
}

/**
 * Claims up to `limit` due jobs for `workerId`. Also reclaims jobs a killed
 * function left in `running`, because nothing else ever would: a function that
 * hit its time limit cannot clean up after itself.
 */
export async function claimJobs(workerId: string, limit = 1): Promise<Job[]> {
  const staleBefore = sql`now() - (${STALE_LOCK_MS}::int * interval '1 millisecond')`;
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      or(
        and(eq(jobs.status, "queued"), lte(jobs.runAfter, sql`now()`)),
        and(eq(jobs.status, "running"), lt(jobs.lockedAt, staleBefore)),
      ),
    )
    .orderBy(asc(jobs.runAfter))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: sql`now()`,
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(inArray(jobs.id, due))
    .returning();
}

/** Every write below is fenced on `locked_by`, so a worker whose job was
 * reclaimed as stale cannot overwrite the outcome of the worker that took it. */
const ownedBy = (job: Job, workerId: string) =>
  and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId), eq(jobs.status, "running"));

async function markSucceeded(job: Job, workerId: string) {
  await db
    .update(jobs)
    .set({ status: "succeeded", finishedAt: sql`now()`, lockedAt: null, lastError: null })
    .where(ownedBy(job, workerId));
}

async function markDead(job: Job, workerId: string, reason: string) {
  await db
    .update(jobs)
    .set({ status: "dead", finishedAt: sql`now()`, lockedAt: null, lastError: reason })
    .where(ownedBy(job, workerId));
}

async function requeue(
  job: Job,
  workerId: string,
  options: { delayMs: number; payload?: Record<string, unknown>; refundAttempt: boolean; error?: string },
) {
  await db
    .update(jobs)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      runAfter: sql`now() + (${Math.max(0, Math.round(options.delayMs))}::int * interval '1 millisecond')`,
      ...(options.payload ? { payload: options.payload } : {}),
      ...(options.refundAttempt ? { attempts: sql`${jobs.attempts} - 1` } : {}),
      ...(options.error !== undefined ? { lastError: options.error } : {}),
    })
    .where(ownedBy(job, workerId));
}

/** Runs one claimed job to an outcome and records it. Never throws. */
export async function runClaimedJob(job: Job, workerId: string, deadline: number): Promise<void> {
  // An older deployment can claim a job kind added by a newer one during a
  // rollout. Handing it back is right; killing it would lose real work. A kind
  // still unknown a day later is not a rollout, so it is retired.
  if (!isJobKind(job.kind)) {
    const ageMs = Date.now() - job.createdAt.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await markDead(job, workerId, `Unknown job kind: ${job.kind}`);
      reportError("jobs.unknown_kind", new Error(`Unknown job kind: ${job.kind}`), { jobId: job.id });
    } else {
      await requeue(job, workerId, { delayMs: 60_000, refundAttempt: true });
    }
    return;
  }

  // A reclaimed stale job has already had its attempt counted by the claim, so
  // one that timed out on its last attempt arrives here over budget.
  if (job.attempts > job.maxAttempts) {
    await markDead(job, workerId, job.lastError ?? "Timed out on its final attempt");
    reportError("jobs.dead", new Error(job.lastError ?? "timed out"), { jobId: job.id, kind: job.kind });
    return;
  }

  const kind: JobKind = job.kind;
  const parsed = JOB_PAYLOADS[kind].safeParse(job.payload);
  if (!parsed.success) {
    // Retrying cannot fix a malformed payload, so it goes straight to dead.
    await markDead(job, workerId, `Invalid payload: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    reportError("jobs.invalid_payload", parsed.error, { jobId: job.id, kind });
    return;
  }

  const startedAt = Date.now();
  try {
    const handler = (await HANDLERS[kind]()) as Handler<typeof kind>;
    const outcome = await handler(parsed.data as JobPayload<typeof kind>, {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      deadline,
    });
    if (outcome && "requeue" in outcome) {
      await requeue(job, workerId, {
        delayMs: outcome.requeue.delayMs ?? 0,
        payload: outcome.requeue.payload,
        refundAttempt: true,
      });
      log.info("jobs.requeued", { jobId: job.id, kind, durationMs: Date.now() - startedAt });
      return;
    }
    await markSucceeded(job, workerId);
    log.info("jobs.succeeded", { jobId: job.id, kind, attempt: job.attempts, durationMs: Date.now() - startedAt });
  } catch (error) {
    const message = errorMessage(error);
    if (job.attempts >= job.maxAttempts) {
      await markDead(job, workerId, message);
      // Dead is the state that needs a human, so it is the one that alerts.
      reportError("jobs.dead", error, { jobId: job.id, kind, attempts: job.attempts });
      return;
    }
    const delayMs = retryDelayMs(job.attempts);
    await requeue(job, workerId, { delayMs, refundAttempt: false, error: message });
    log.warn("jobs.retry_scheduled", { jobId: job.id, kind, attempt: job.attempts, delayMs, error });
  }
}

/** The soonest queued job's start time, so a drainer can wait for a retry that
 * is due inside its own budget instead of leaving it for the next kick. */
async function nextRunAfter(): Promise<Date | null> {
  const [row] = await db
    .select({ runAfter: jobs.runAfter })
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.runAfter))
    .limit(1);
  return row?.runAfter ?? null;
}

export interface DrainResult {
  workerId: string;
  ran: number;
  stoppedBecause: "empty" | "budget" | "max_jobs";
}

/**
 * Claims and runs jobs one at a time until the queue is empty or the budget is
 * spent. One at a time on purpose: a function has one vCPU on Hobby, and the
 * expensive jobs (sharp, ZIP streaming) are CPU-bound, so running them in
 * parallel would only make each one slower and more likely to be killed.
 *
 * Leaves a margin before the budget so a job is never started that the function
 * cannot finish. A job killed mid-run is recovered by the stale-lock reclaim,
 * but only fifteen minutes later.
 */
export async function drainJobs({
  budgetMs,
  maxJobs = 500,
  workerId = `w_${nanoid(10)}`,
}: {
  budgetMs: number;
  maxJobs?: number;
  workerId?: string;
}): Promise<DrainResult> {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  // Below this, starting another job risks being killed half way through it.
  // Floored, because a third of a tiny budget is no margin at all: a zero
  // budget must start nothing rather than one job with no time to finish.
  const minimumRunwayMs = Math.max(1_000, Math.min(20_000, budgetMs / 3));
  let ran = 0;

  while (ran < maxJobs) {
    if (deadline - Date.now() < minimumRunwayMs) {
      return { workerId, ran, stoppedBecause: "budget" };
    }

    const [job] = await claimJobs(workerId, 1);
    if (!job) {
      // Nothing due. If a retry falls due before the budget runs out, wait for
      // it here. On Hobby the alternative is waiting for the next kick, which
      // for a quiet gallery can mean the daily cron.
      const next = await nextRunAfter();
      const waitMs = next ? next.getTime() - Date.now() : Infinity;
      if (waitMs <= 60_000 && Date.now() + waitMs < deadline - minimumRunwayMs) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(250, waitMs)));
        continue;
      }
      return { workerId, ran, stoppedBecause: "empty" };
    }

    await runClaimedJob(job, workerId, deadline - 5_000);
    ran += 1;
  }

  return { workerId, ran, stoppedBecause: "max_jobs" };
}

/**
 * Finished rows are history, not state. Kept a week when they succeeded and a
 * month when they died, since a dead job is the one somebody will come asking
 * about.
 */
export async function pruneFinishedJobs(): Promise<number> {
  const removed = await db
    .delete(jobs)
    .where(
      or(
        and(eq(jobs.status, "succeeded"), lt(jobs.finishedAt, sql`now() - interval '7 days'`)),
        and(eq(jobs.status, "dead"), lt(jobs.finishedAt, sql`now() - interval '30 days'`)),
      ),
    )
    .returning({ id: jobs.id });
  return removed.length;
}
