import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { jobs } from "./schema";
import { log } from "./observability";

/**
 * F-5: the background job queue, enqueue side.
 *
 * Every kind of job is declared here with the shape of its payload, so a typo in
 * a kind or a missing field is a type error at the call site rather than a job
 * that sits in the table failing validation five times before anyone notices.
 * The handlers live in `lib/job-runner.ts`, behind dynamic imports, so a route
 * that only enqueues does not pull sharp or the S3 listing code into its bundle.
 *
 * **How jobs get run on the Hobby plan.** Vercel Hobby allows cron jobs once a
 * day, which is far too slow to be the main trigger. So the main trigger is the
 * enqueue itself: `enqueueAndKick` queues the row and then, after the response
 * has gone, asks a separate function to drain the queue. The daily cron in
 * `app/api/cron/jobs` is the backstop for anything a kick missed, and an
 * external per-minute heartbeat can be pointed at the same route to make retries
 * prompt. See ROADMAP.md F-5.
 */
export const JOB_PAYLOADS = {
  /** SEC-2: delete objects under `events/` that no media row references. */
  "uploads.reap_orphans": z.object({
    // ListObjectsV2 continuation, so a large bucket is walked across several
    // runs rather than restarted from the top each time one is cut short.
    continuationToken: z.string().optional(),
    // Report what would be deleted and delete nothing. The first production
    // run of a job whose whole purpose is deleting bytes should be this one.
    dryRun: z.boolean().optional(),
    // Carried across continuations so the circuit breaker judges the whole
    // walk, not just the page it happens to be on.
    scanned: z.number().int().nonnegative().optional(),
    orphaned: z.number().int().nonnegative().optional(),
  }),
  /** The grid rendition for one photo, or for one video's poster still. */
  "media.thumbnail": z.object({ mediaId: z.string().min(1).max(64) }),
  /** Finds media with no thumbnail and queues a `media.thumbnail` for each. */
  "media.backfill_thumbnails": z.object({}),
  /** ACT-1: repair half-spent passes and lapse events whose grant has ended. */
  "entitlements.reconcile": z.object({}),
  /** MED-7: build one ZIP part of an export into the bucket. */
  "export.part": z.object({ exportId: z.string().min(1).max(64), part: z.number().int().nonnegative() }),
  /** MED-7: delete exports past their week, and anything left under exports/. */
  "exports.expire": z.object({}),
  /** PAY-7: email the host that their event crossed a storage threshold. */
  "notify.usage": z.object({ eventId: z.string().min(1).max(64), level: z.union([z.literal(75), z.literal(90), z.literal(100)]) }),
  /** SEC-1: warn hosts 30, 7 and 1 days before their gallery closes. */
  "notify.retention": z.object({}),
  /** F-4: recompute the usage counters from the media rows. */
  "usage.reconcile": z.object({}),
  /** MED-8: remove the location a phone wrote into one video. */
  "media.scrub_video": z.object({ mediaId: z.string().min(1).max(64) }),
  /** MED-8: queue a scrub for every video that has not had one. */
  "media.backfill_video_scrubs": z.object({}),
  /** AI-1: work out one event's moments and bursts. */
  "moments.refresh": z.object({ eventId: z.string().min(1).max(64) }),
  /** AI-1: refresh every event with recent media. */
  "moments.backfill": z.object({}),
} as const;

export type JobKind = keyof typeof JOB_PAYLOADS;
export type JobPayload<K extends JobKind> = z.infer<(typeof JOB_PAYLOADS)[K]>;

/** Queues a thumbnail for one media row, at most once while one is pending. */
export function enqueueThumbnail(mediaId: string) {
  return enqueue("media.thumbnail", { mediaId }, { dedupeKey: `thumb:${mediaId}`, maxAttempts: 3 });
}

/** Queues the location scrub for one video, at most once while one is pending. */
export function enqueueVideoScrub(mediaId: string) {
  return enqueue("media.scrub_video", { mediaId }, { dedupeKey: `scrub:${mediaId}`, maxAttempts: 4 });
}

/**
 * Queues the moments for one event. Collapsed while one is pending, so a
 * hundred uploads in a minute are one run; the run goes round again itself if
 * photos arrived while it was working.
 */
export function enqueueMomentsRefresh(eventId: string) {
  return enqueue("moments.refresh", { eventId }, { dedupeKey: `moments:${eventId}`, maxAttempts: 3 });
}

export function isJobKind(kind: string): kind is JobKind {
  return Object.hasOwn(JOB_PAYLOADS, kind);
}

export interface EnqueueOptions {
  /** Not before this moment. Defaults to now. */
  runAfter?: Date;
  /**
   * Collapses duplicates: while a job with this key is queued or running, a
   * second enqueue is a no-op. Use it for work that is about one thing, such as
   * a thumbnail for one media id, so a retried request cannot queue it twice.
   */
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Queues one job. Returns whether a row was actually written, which is false
 * only when `dedupeKey` matched a job that is still live.
 *
 * The payload is validated here as well as when it runs. A bad payload caught
 * at enqueue is a failed request the caller can see; caught at run time it is a
 * dead job nobody is watching.
 */
export async function enqueue<K extends JobKind>(
  kind: K,
  payload: JobPayload<K>,
  options: EnqueueOptions = {},
): Promise<{ id: string; enqueued: boolean }> {
  const parsed = JOB_PAYLOADS[kind].parse(payload);
  const id = nanoid();
  const rows = await db
    .insert(jobs)
    .values({
      id,
      kind,
      payload: parsed,
      runAfter: options.runAfter ?? sql`now()`,
      maxAttempts: options.maxAttempts ?? 5,
      dedupeKey: options.dedupeKey ?? null,
    })
    // The target has to name the partial index's predicate, or Postgres cannot
    // infer which unique index the conflict is against and refuses the insert.
    .onConflictDoNothing({
      target: jobs.dedupeKey,
      where: sql`${jobs.dedupeKey} IS NOT NULL AND ${jobs.status} IN ('queued', 'running')`,
    })
    .returning({ id: jobs.id });

  return { id, enqueued: rows.length > 0 };
}

/**
 * Asks a fresh function to drain the queue. Call it from inside `after()`, so
 * the request that queued the work is never slowed down by it.
 *
 * A separate invocation rather than draining in-process, because the route that
 * queued the job has its own short time budget and its own reason for existing.
 * Production only: preview deployments sit behind Vercel's deployment
 * protection, so a request to their own URL is refused, and APP_URL is the
 * production domain. Anywhere else the queue is drained in-process instead,
 * which is also what makes this work under `next dev` with no secret set.
 */
export async function kickJobRunner(): Promise<void> {
  const secret = env.CRON_SECRET;
  const base = env.APP_URL;
  if (process.env.VERCEL_ENV !== "production" || !secret || !base) {
    const { drainJobs } = await import("./job-runner");
    await drainJobs({ budgetMs: 25_000 });
    return;
  }

  try {
    // The run route answers 202 straight away and does its work after the
    // response, so this resolves in well under the timeout. The timeout is only
    // there so a hung network cannot hold this function open.
    await fetch(`${base}/api/jobs/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    // Not fatal. The job is safely in the table, and the next kick or the daily
    // cron will pick it up. Logged because a kick that always fails would mean
    // every job waits a day, which is a real outage that looks like nothing.
    log.warn("jobs.kick_failed", { error });
  }
}

/**
 * Work that should happen once per UTC day, whoever asks first. The cron route
 * calls this on every hit, so an external heartbeat polling that route every
 * minute still schedules each of these exactly once a day.
 *
 * Checked against every status, not just live ones: the dedupe index only
 * covers queued and running jobs, and a reaper that finished at 04:01 must not
 * be queued again at 04:02.
 */
export async function scheduleDailyJobs(now = new Date()): Promise<JobKind[]> {
  const day = now.toISOString().slice(0, 10);
  const daily: Array<{ kind: JobKind; payload: JobPayload<JobKind> }> = [
    { kind: "uploads.reap_orphans", payload: {} },
    // Self-healing rather than a one-off script: catches the existing media,
    // any upload whose thumbnail failed, and anything a future bug misses.
    { kind: "media.backfill_thumbnails", payload: {} },
    // An end date passes without anything writing to the row, so something has
    // to look. Daily is fine: grants end on dates, not minutes.
    { kind: "entitlements.reconcile", payload: {} },
    { kind: "exports.expire", payload: {} },
    { kind: "notify.retention", payload: {} },
    { kind: "usage.reconcile", payload: {} },
    // MED-8: videos from before the scrub existed, and any whose job was lost.
    { kind: "media.backfill_video_scrubs", payload: {} },
    // AI-1: anything a kick missed, and capture times found after the fact.
    { kind: "moments.backfill", payload: {} },
  ];

  const scheduled: JobKind[] = [];
  for (const { kind, payload } of daily) {
    const dedupeKey = `daily:${kind}:${day}`;
    const [existing] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(sql`${jobs.dedupeKey} = ${dedupeKey}`)
      .limit(1);
    if (existing) continue;
    const { enqueued } = await enqueue(kind, payload, { dedupeKey });
    if (enqueued) scheduled.push(kind);
  }
  return scheduled;
}
