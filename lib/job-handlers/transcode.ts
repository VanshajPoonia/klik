import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { media, streamDeletions } from "../schema";
import { signObjectUrl } from "../media-urls";
import { enqueueTranscode, type JobPayload } from "../jobs";
import {
  StreamError,
  copyToStream,
  customerHost,
  deleteStreamVideo,
  ensureStreamWebhook,
  getStreamVideo,
  isStreamConfigured,
  rememberCustomerHost,
} from "../stream";
import { log } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

/** How often a pending copy is looked at while no webhook has arrived. */
const POLL_MS = 15_000;
/** Stream encodes a three-minute clip in well under this; past it, the original plays. */
const GIVE_UP_MS = 2 * 60 * 60 * 1000;

/**
 * OPS-1: one video to Stream, then watched until it plays. Idempotent: a
 * ready, failed, deleted or missing video is done, and so is anything while
 * Stream has no key. Until its copy is ready, and for ever if it fails, the
 * original in R2 plays exactly as before.
 */
export async function transcodeVideo(payload: JobPayload<"media.transcode">, context: JobContext): Promise<JobOutcome> {
  if (!isStreamConfigured()) return;
  const [row] = await db
    .select({
      id: media.id,
      eventId: media.eventId,
      kind: media.kind,
      mimeType: media.mimeType,
      blobPathname: media.blobPathname,
      metadataState: media.metadataState,
      deletedAt: media.deletedAt,
      createdAt: media.createdAt,
      streamUid: media.streamUid,
      streamState: media.streamState,
    })
    .from(media)
    .where(eq(media.id, payload.mediaId))
    .limit(1);
  if (!row || row.kind !== "video" || row.deletedAt) return;
  if (row.streamState === "ready" || row.streamState === "failed") return;
  // The location comes out first (MED-8); the scrub queues this when it ends.
  if (row.metadataState === "pending") return;

  try {
    if (!row.streamUid) {
      await ensureStreamWebhook();
      // Six hours: Stream fetches straight away, but a queue on their side
      // must not find the link dead.
      const url = await signObjectUrl(row.blobPathname, row.mimeType, Date.now(), 3 * 60 * 60 * 1000);
      const video = await copyToStream(url, { mediaId: row.id, eventId: row.eventId });
      await db
        .update(media)
        .set({ streamUid: video.uid, streamState: "pending" })
        .where(and(eq(media.id, row.id), isNull(media.streamUid)));
      log.info("stream.copy_started", { mediaId: row.id, uid: video.uid });
      return { requeue: { delayMs: POLL_MS } };
    }

    const video = await getStreamVideo(row.streamUid);
    if (video.readyToStream) {
      const host = customerHost(video.hls);
      if (host) await rememberCustomerHost(host);
      await db.update(media).set({ streamState: "ready" }).where(eq(media.id, row.id));
      log.info("stream.ready", { mediaId: row.id });
      return;
    }
    if (video.state === "error" || Date.now() - row.createdAt.getTime() > GIVE_UP_MS) {
      await db.update(media).set({ streamState: "failed" }).where(eq(media.id, row.id));
      log.warn("stream.failed", { mediaId: row.id, reason: video.errorReasonCode ?? video.state });
      return;
    }
    return { requeue: { delayMs: POLL_MS } };
  } catch (error) {
    const retryable = !(error instanceof StreamError) || error.retryable;
    if (retryable && context.attempt < context.maxAttempts) throw error;
    await db.update(media).set({ streamState: "failed" }).where(eq(media.id, row.id));
    log.warn("stream.failed", { mediaId: row.id, error });
  }
}

/** How many one backfill run queues. */
const BACKFILL_BATCH = 200;

/** Videos with no copy, newest first. Nothing without a key. */
export async function backfillTranscodes(payload: JobPayload<"media.backfill_transcodes">, context: JobContext): Promise<JobOutcome> {
  void payload;
  void context;
  if (!isStreamConfigured()) return;
  const waiting = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.kind, "video"),
        isNull(media.deletedAt),
        or(isNull(media.streamState), and(eq(media.streamState, "pending"), lt(media.createdAt, sql`now() - interval '1 hour'`))),
        or(isNull(media.metadataState), sql`${media.metadataState} <> 'pending'`),
      ),
    )
    .orderBy(desc(media.createdAt))
    .limit(BACKFILL_BATCH);
  let queued = 0;
  for (const { id } of waiting) if ((await enqueueTranscode(id)).enqueued) queued += 1;
  log.info("stream.backfill_queued", { found: waiting.length, queued });
}

/**
 * Deletes the Stream copies the database queued when their videos were
 * deleted for good. One that keeps failing is kept and retried each day; it
 * is in the log, and it plays nothing, since every copy needs a signed URL.
 */
export async function reapStreamCopies(payload: JobPayload<"stream.reap">, context: JobContext): Promise<JobOutcome> {
  void payload;
  const queued = await db.select().from(streamDeletions).orderBy(asc(streamDeletions.queuedAt)).limit(500);
  if (queued.length === 0) return;
  if (!isStreamConfigured()) {
    log.warn("stream.reap_unconfigured", { waiting: queued.length });
    return;
  }
  let deleted = 0;
  for (const row of queued) {
    if (context.deadline - Date.now() < 5_000) return { requeue: { delayMs: 0 } };
    try {
      await deleteStreamVideo(row.uid);
      await db.delete(streamDeletions).where(eq(streamDeletions.uid, row.uid));
      deleted += 1;
    } catch (error) {
      await db
        .update(streamDeletions)
        .set({ attempts: sql`${streamDeletions.attempts} + 1` })
        .where(eq(streamDeletions.uid, row.uid));
      log.warn("stream.reap_failed", { uid: row.uid, error });
    }
  }
  log.info("stream.reaped", { deleted, waiting: queued.length - deleted });
}
