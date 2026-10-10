import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { media } from "../schema";
import { r2 } from "../storage";
import { enqueueAnalysis, type JobPayload } from "../jobs";
import { differenceHash, laplacianVariance, meanBrightness } from "../image-analysis";
import { log } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

/** Long edge of the grey rendition sharpness is measured on. */
const MEASURE_EDGE = 256;

/**
 * AI-7, AI-8: measures one photo from its grid tile, which is already small
 * and already upright, or from the photo itself when there is no tile yet.
 * Idempotent: a measured, deleted or missing photo is done.
 */
export async function analyzeMedia(payload: JobPayload<"media.analyze">, context: JobContext): Promise<JobOutcome> {
  void context;
  const [row] = await db
    .select({ id: media.id, kind: media.kind, blob: media.blobPathname, thumb: media.thumbPathname, analyzedAt: media.analyzedAt })
    .from(media)
    .where(eq(media.id, payload.mediaId))
    .limit(1);
  if (!row || row.kind !== "photo" || row.analyzedAt) return;

  const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: row.thumb ?? row.blob }));
  if (!object.Body) throw new Error(`No body for ${row.id}`);
  const source = Buffer.from(await object.Body.transformToByteArray());

  const sharp = (await import("sharp")).default;
  let hash: string;
  let sharpness: number;
  let brightness: number;
  try {
    const tiny = await sharp(source, { failOn: "none" }).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    const { data, info } = await sharp(source, { failOn: "none" })
      .rotate()
      .grayscale()
      .resize(MEASURE_EDGE, MEASURE_EDGE, { fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    hash = differenceHash(new Uint8Array(tiny));
    sharpness = laplacianVariance(new Uint8Array(data), info.width, info.height);
    brightness = meanBrightness(new Uint8Array(data));
  } catch (error) {
    // Undecodable: recorded as measured with nothing, so it is not tried for ever.
    log.warn("analyze.undecodable", { mediaId: row.id, error });
    await db.update(media).set({ analyzedAt: new Date() }).where(eq(media.id, row.id));
    return;
  }

  await db
    .update(media)
    .set({ perceptualHash: hash, sharpness, brightness, analyzedAt: new Date() })
    .where(and(eq(media.id, row.id), isNull(media.analyzedAt)));
}

/** How many photos one backfill run queues. The rest wait for tomorrow. */
const BACKFILL_BATCH = 500;

export async function backfillAnalysis(payload: JobPayload<"media.backfill_analysis">, context: JobContext): Promise<JobOutcome> {
  void payload;
  void context;
  const waiting = await db
    .select({ id: media.id })
    .from(media)
    .where(and(isNull(media.analyzedAt), eq(media.kind, "photo"), isNull(media.deletedAt)))
    .orderBy(asc(media.createdAt))
    .limit(BACKFILL_BATCH);
  let queued = 0;
  for (const { id } of waiting) {
    if ((await enqueueAnalysis(id)).enqueued) queued += 1;
  }
  log.info("analyze.backfill_queued", { found: waiting.length, queued });
}
