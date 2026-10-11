import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { media, mediaVision } from "../schema";
import { r2 } from "../storage";
import { enqueueDescription, type JobPayload } from "../jobs";
import { describePhoto, embedTexts, isVisionConfigured, WorkersAiError } from "../ai/workers-ai";
import { VISION_EDGE, VISION_MODEL, embeddingText } from "../vision";
import { holdForReview } from "../screening";
import { log } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

/**
 * AI-2, AI-6: describes one photo, or one video by its poster still, once.
 *
 * Idempotent: a described, deleted or missing photo is done, and so is any
 * photo while Workers AI has no key, so jobs queued before a key is removed
 * finish quietly. A photo the model cannot describe after its retries is
 * stored as `failed`, so the daily backfill does not pay for it every day.
 */
export async function describeMedia(payload: JobPayload<"media.describe">, context: JobContext): Promise<JobOutcome> {
  if (!isVisionConfigured()) return;
  const [row] = await db
    .select({
      id: media.id,
      eventId: media.eventId,
      kind: media.kind,
      blob: media.blobPathname,
      thumb: media.thumbPathname,
      poster: media.posterPathname,
      deletedAt: media.deletedAt,
      described: mediaVision.mediaId,
    })
    .from(media)
    .leftJoin(mediaVision, eq(mediaVision.mediaId, media.id))
    .where(eq(media.id, payload.mediaId))
    .limit(1);
  if (!row || row.deletedAt || row.described) return;
  const key = row.kind === "photo" ? (row.thumb ?? row.blob) : row.poster;
  if (!key) return;

  const fail = async (reason: string) => {
    log.warn("vision.failed", { mediaId: row.id, reason });
    await db
      .insert(mediaVision)
      .values({ mediaId: row.id, eventId: row.eventId, state: "failed", model: VISION_MODEL })
      .onConflictDoNothing();
  };

  const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  if (!object.Body) throw new Error(`No body for ${row.id}`);
  const source = Buffer.from(await object.Body.transformToByteArray());

  let jpeg: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    jpeg = await sharp(source, { failOn: "none" })
      .rotate()
      .resize(VISION_EDGE, VISION_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    await fail("undecodable");
    return;
  }

  try {
    const result = await describePhoto(jpeg);
    if (result.kind === "refused") {
      // Nothing to search by, and held for the organizer: a vision model that
      // will not describe a photo usually has a reason.
      const stored = await db
        .insert(mediaVision)
        .values({ mediaId: row.id, eventId: row.eventId, state: "done", model: VISION_MODEL, safety: "unclear" })
        .onConflictDoNothing()
        .returning({ mediaId: mediaVision.mediaId });
      if (stored.length > 0) await holdForReview({ mediaId: row.id, eventId: row.eventId, safety: "unclear", reasons: [] });
      return;
    }
    const { caption, labels, safety, reasons } = result.description;
    const [embedding] = await embedTexts([embeddingText(caption, labels)]);
    const inserted = await db
      .insert(mediaVision)
      .values({
        mediaId: row.id,
        eventId: row.eventId,
        state: "done",
        model: VISION_MODEL,
        caption,
        labels,
        embedding,
        safety,
        safetyReasons: reasons,
      })
      .onConflictDoNothing()
      .returning({ mediaId: mediaVision.mediaId });
    if (inserted.length > 0 && safety === "flagged") {
      await holdForReview({ mediaId: row.id, eventId: row.eventId, safety, reasons });
    }
  } catch (error) {
    const retryable = !(error instanceof WorkersAiError) || error.retryable;
    if (retryable && context.attempt < context.maxAttempts) throw error;
    await fail(error instanceof Error ? error.message.slice(0, 200) : "failed");
  }
}

/** How many one backfill run queues. The rest wait for tomorrow. */
const BACKFILL_BATCH = 500;

/**
 * Everything not yet described, newest first: when the key first arrives, the
 * events happening now matter more than last spring's. Nothing without a key.
 */
export async function backfillVision(payload: JobPayload<"media.backfill_vision">, context: JobContext): Promise<JobOutcome> {
  void payload;
  void context;
  if (!isVisionConfigured()) return;
  const waiting = await db
    .select({ id: media.id })
    .from(media)
    .leftJoin(mediaVision, eq(mediaVision.mediaId, media.id))
    .where(
      and(
        isNull(mediaVision.mediaId),
        isNull(media.deletedAt),
        or(eq(media.kind, "photo"), and(eq(media.kind, "video"), isNotNull(media.posterPathname))),
        // A rejected photo is out of the gallery for good; describing it buys nothing.
        sql`${media.status} <> 'rejected'`,
      ),
    )
    .orderBy(desc(media.createdAt))
    .limit(BACKFILL_BATCH);
  let queued = 0;
  for (const { id } of waiting) {
    if ((await enqueueDescription(id)).enqueued) queued += 1;
  }
  log.info("vision.backfill_queued", { found: waiting.length, queued });
}
