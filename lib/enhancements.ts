import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { aiEnhancements, events, media, type AiEnhancement, type Event } from "./schema";
import { blobPathnameFor, r2 } from "./storage";
import { signObjectUrl } from "./media-urls";
import { mediaContentPath } from "./media-delivery";
import { eventPlan } from "./license";
import { eventUsage } from "./usage";
import { isLockedProof } from "./proofs";
import { enqueue, enqueueAnalysis, enqueueDescription, enqueueMomentsRefresh, enqueueThumbnail } from "./jobs";
import { isVisionConfigured } from "./ai/workers-ai";
import {
  ReplicateError,
  cancelPrediction,
  createUpscale,
  getPrediction,
  isReplicateConfigured,
  outputUrl,
} from "./ai/replicate";
import { getAppUrl } from "./env";
import { log } from "./observability";
import type { JobContext, JobOutcome } from "./job-runner";

/**
 * AI-5's cloud tier: "sharpen and enlarge" one photo with Real-ESRGAN.
 *
 * **Never destructive.** The result is a new photo pointing at its source
 * (`derived_from_id`), hidden until the host picks: show it instead (the
 * source is hidden), show both, or throw it away. The source is never
 * changed. **Never a face model**: GFPGAN and CodeFormer find and redraw
 * faces, and Klik keeps out of face processing for the reasons AI-3 was cut.
 *
 * Real-ESRGAN wants an input no bigger than about 1440 pixels, so the job
 * sends a 1440px rendition (a temporary object beside the photo, removed when
 * the run ends and swept by the orphan reaper if it is not) and asks for four
 * times that, then stores at most 4096 pixels on the long edge: enough for an
 * 8 by 10 inch print at 300 dots per inch, and a photo sent over WhatsApp at
 * 1080 comes back at print size.
 */

export const ENHANCE_INPUT_EDGE = 1440;
export const ENHANCE_SCALE = 4;
export const ENHANCE_OUTPUT_EDGE = 4096;
/** A run still going after this is cancelled and counted as failed. */
export const ENHANCE_TIMEOUT_MS = 15 * 60 * 1000;
/** How often the job looks again while the webhook has not arrived. */
const POLL_MS = 8_000;
/** The largest output Klik will download. A 4x Real-ESRGAN PNG of 1440px is ~40 MB. */
const MAX_OUTPUT_BYTES = 120 * 1024 * 1024;

export function isEnhanceAvailable(): boolean {
  return isReplicateConfigured();
}

export class EnhanceError extends Error {
  constructor(readonly code: "not_configured" | "not_found" | "not_photo" | "locked" | "limit" | "full" | "running") {
    super(code);
  }
}

export const ENHANCE_REFUSALS: Record<EnhanceError["code"], string> = {
  not_configured: "Enhancement is not switched on yet",
  not_found: "That photo is gone",
  not_photo: "Only photos can be enhanced",
  locked: "That photo cannot be changed right now",
  limit: "This event has used all its enhancements",
  full: "This event's storage is full",
  running: "That photo is already being enhanced",
};

/** The temporary input beside its source, swept by the reaper if a run dies. */
export function enhanceInputKey(eventId: string, sourceId: string): string {
  return blobPathnameFor(eventId, `${sourceId}-enhance`, "jpg");
}

export async function enhancementAllowance(event: Event): Promise<{ used: number; limit: number }> {
  const [{ used }] = await db
    .select({ used: count() })
    .from(aiEnhancements)
    .where(and(eq(aiEnhancements.eventId, event.id), ne(aiEnhancements.status, "failed")));
  return { used, limit: eventPlan(event).aiEnhancementsPerEvent };
}

export async function requestEnhancement({
  event,
  mediaId,
  userId,
}: {
  event: Event;
  mediaId: string;
  userId: string;
}): Promise<AiEnhancement> {
  if (!isEnhanceAvailable()) throw new EnhanceError("not_configured");
  const [source] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id), isNull(media.deletedAt)))
    .limit(1);
  if (!source) throw new EnhanceError("not_found");
  if (source.kind !== "photo") throw new EnhanceError("not_photo");
  // A locked proof's stored bytes are the watermark; a held photo is evidence.
  if (isLockedProof(source) || source.legalHoldAt) throw new EnhanceError("locked");
  const { used, limit } = await enhancementAllowance(event);
  if (used >= limit) throw new EnhanceError("limit");
  if (eventUsage(event, eventPlan(event)).full) throw new EnhanceError("full");

  const id = `enh_${nanoid()}`;
  const [row] = await db
    .insert(aiEnhancements)
    .values({ id, eventId: event.id, mediaId, operation: "upscale", requestedByUserId: userId })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new EnhanceError("running");
  await enqueue("ai.enhance", { enhancementId: id }, { dedupeKey: `enhance:${id}`, maxAttempts: 5 });
  log.info("enhance.requested", { eventId: event.id, mediaId, enhancementId: id });
  return row;
}

export async function listEnhancements(eventId: string) {
  return db
    .select()
    .from(aiEnhancements)
    .where(eq(aiEnhancements.eventId, eventId))
    .orderBy(desc(aiEnhancements.createdAt))
    .limit(50);
}

async function fail(row: AiEnhancement, reason: string) {
  await db
    .update(aiEnhancements)
    .set({ status: "failed", error: reason.slice(0, 500), finishedAt: new Date() })
    .where(and(eq(aiEnhancements.id, row.id), inArray(aiEnhancements.status, ["queued", "running"])));
  await r2
    .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: enhanceInputKey(row.eventId, row.mediaId) }))
    .catch(() => undefined);
  log.warn("enhance.failed", { enhancementId: row.id, reason });
}

/** Where Replicate says a run finished. Production only: previews sit behind Vercel's protection. */
function webhookUrl(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  return `${getAppUrl()}/api/webhooks/replicate`;
}

/** The F-5 job: starts the run, then looks again until it ends. */
export async function runEnhancement(payload: { enhancementId: string }, context: JobContext): Promise<JobOutcome> {
  const [row] = await db.select().from(aiEnhancements).where(eq(aiEnhancements.id, payload.enhancementId)).limit(1);
  if (!row || row.status === "succeeded" || row.status === "failed") return;
  if (!isReplicateConfigured()) {
    await fail(row, "Replicate is not configured");
    return;
  }

  try {
    if (row.status === "queued") return await start(row);
    if (Date.now() - row.createdAt.getTime() > ENHANCE_TIMEOUT_MS) {
      if (row.predictionId) await cancelPrediction(row.predictionId);
      await fail(row, "It took too long");
      return;
    }
    const prediction = await getPrediction(row.predictionId!);
    if (prediction.status === "succeeded") return await finish(row, prediction.output);
    if (prediction.status === "failed" || prediction.status === "canceled") {
      await fail(row, typeof prediction.error === "string" ? prediction.error : `Replicate ${prediction.status}`);
      return;
    }
    return { requeue: { delayMs: POLL_MS } };
  } catch (error) {
    const retryable = !(error instanceof ReplicateError) || error.retryable;
    if (retryable && context.attempt < context.maxAttempts) throw error;
    await fail(row, error instanceof Error ? error.message : "failed");
  }
}

async function start(row: AiEnhancement): Promise<JobOutcome> {
  const [source] = await db.select().from(media).where(eq(media.id, row.mediaId)).limit(1);
  if (!source || source.deletedAt) {
    await fail(row, "The photo is gone");
    return;
  }
  const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: source.blobPathname }));
  if (!object.Body) throw new Error(`No body for ${source.id}`);
  const sharp = (await import("sharp")).default;
  let input: Buffer;
  try {
    input = await sharp(Buffer.from(await object.Body.transformToByteArray()), { failOn: "none" })
      .rotate()
      .resize(ENHANCE_INPUT_EDGE, ENHANCE_INPUT_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch {
    await fail(row, "The photo could not be read");
    return;
  }
  const key = enhanceInputKey(row.eventId, row.mediaId);
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: input, ContentType: "image/jpeg" }));
  // An hour is far longer than a run, and the object is deleted when it ends.
  const url = await signObjectUrl(key, "image/jpeg", Date.now(), 60 * 60 * 1000);
  const prediction = await createUpscale(url, { scale: ENHANCE_SCALE, webhook: webhookUrl() });
  await db
    .update(aiEnhancements)
    .set({ status: "running", predictionId: prediction.id })
    .where(and(eq(aiEnhancements.id, row.id), eq(aiEnhancements.status, "queued")));
  return { requeue: { delayMs: POLL_MS } };
}

async function finish(row: AiEnhancement, output: unknown): Promise<JobOutcome> {
  const url = outputUrl(output);
  if (!url) {
    await fail(row, "Replicate returned no image");
    return;
  }
  const [source] = await db.select().from(media).where(eq(media.id, row.mediaId)).limit(1);
  const [event] = await db.select({ slug: events.slug }).from(events).where(eq(events.id, row.eventId)).limit(1);
  if (!source || source.deletedAt || !event) {
    await fail(row, "The photo is gone");
    return;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Replicate output ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_OUTPUT_BYTES) {
    await fail(row, "The result was too large");
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_OUTPUT_BYTES) {
    await fail(row, "The result was too large");
    return;
  }

  const sharp = (await import("sharp")).default;
  let stored: { data: Buffer; info: { width: number; height: number; size: number } };
  try {
    // Re-encoded, so whatever came back is a plain JPEG with no metadata.
    stored = await sharp(bytes, { failOn: "none", limitInputPixels: 80_000_000 })
      .resize(ENHANCE_OUTPUT_EDGE, ENHANCE_OUTPUT_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    await fail(row, "The result could not be read");
    return;
  }

  const id = nanoid();
  const key = blobPathnameFor(row.eventId, id, "jpg");
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: stored.data, ContentType: "image/jpeg" }));
  await db.insert(media).values({
    id,
    eventId: row.eventId,
    guestId: null,
    albumId: source.albumId,
    derivedFromId: source.id,
    kind: "photo",
    status: "approved",
    // Hidden until the host chooses what to do with it.
    visibility: "private",
    blobUrl: mediaContentPath(event.slug, id),
    blobPathname: key,
    mimeType: "image/jpeg",
    sizeBytes: stored.data.length,
    width: stored.info.width,
    height: stored.info.height,
    capturedAt: source.capturedAt,
  });
  await db
    .update(aiEnhancements)
    .set({ status: "succeeded", resultMediaId: id, finishedAt: new Date(), error: null })
    .where(eq(aiEnhancements.id, row.id));
  await r2
    .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: enhanceInputKey(row.eventId, row.mediaId) }))
    .catch(() => undefined);
  await Promise.all([
    enqueueThumbnail(id),
    enqueueAnalysis(id),
    isVisionConfigured() ? enqueueDescription(id) : Promise.resolve(),
    enqueueMomentsRefresh(row.eventId),
  ]);
  log.info("enhance.succeeded", { enhancementId: row.id, resultMediaId: id, bytes: stored.data.length });
}

/**
 * The host's call on a finished result. `instead` shows it where the source
 * was shown and hides the source; `both` shows it beside the source;
 * `discarded` puts it in the trash, where it can still be restored.
 */
export async function chooseEnhancement(
  eventId: string,
  enhancementId: string,
  choice: "instead" | "both" | "discarded",
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(aiEnhancements)
    .where(and(eq(aiEnhancements.id, enhancementId), eq(aiEnhancements.eventId, eventId), eq(aiEnhancements.status, "succeeded")))
    .limit(1);
  if (!row?.resultMediaId) return false;
  const [source] = await db.select().from(media).where(eq(media.id, row.mediaId)).limit(1);
  const [result] = await db.select().from(media).where(and(eq(media.id, row.resultMediaId), isNull(media.deletedAt))).limit(1);
  if (!result) return false;
  const shownAs = source && !source.deletedAt ? source.visibility : "gallery";

  if (choice === "discarded") {
    await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, result.id));
  } else {
    await db.update(media).set({ visibility: shownAs }).where(eq(media.id, result.id));
    if (choice === "instead" && source && !source.deletedAt) {
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, source.id));
    }
  }
  await db.update(aiEnhancements).set({ choice }).where(eq(aiEnhancements.id, row.id));
  return true;
}
