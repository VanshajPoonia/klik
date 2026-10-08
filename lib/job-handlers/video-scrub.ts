import { Transform, type Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { media } from "../schema";
import { deleteBlobs, r2 } from "../storage";
import { uploadStream } from "../multipart-upload";
import { applyPatches, planVideoScrub, type Patch, type ReadRange } from "../video-metadata";
import { enqueueVideoScrub, type JobPayload } from "../jobs";
import { log, reportError } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

/**
 * MED-8: removes the location a phone wrote into one video, in place.
 *
 * Reads only the box headers and metadata boxes to plan the patch (see
 * lib/video-metadata.ts), and when there is something to remove, streams the
 * object through once, patching as it goes, back to the same key. Nothing
 * changes size, nothing is re-encoded. Then reads the result back and plans
 * again, and only calls it clean when that finds nothing.
 *
 * Idempotent: a clean video is done, and a scrubbed file plans no patches.
 */

/** A rewrite streams up to 200 MB both ways; this much runway or it waits. */
const MIN_RUNWAY_MS = 90_000;

function rangeReader(key: string): ReadRange {
  return async (offset, length) => {
    if (length <= 0) return Buffer.alloc(0);
    const object = await r2.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Range: `bytes=${offset}-${offset + length - 1}`,
      }),
    );
    if (!object.Body) throw new Error(`Range read returned no body: ${key}`);
    return Buffer.from(await object.Body.transformToByteArray());
  };
}

function patchingStream(patches: Patch[]): Transform {
  let at = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const out = applyPatches(chunk, at, patches);
      at += chunk.length;
      done(null, out);
    },
  });
}

async function setState(id: string, state: "clean" | "failed", capturedAt: string | null) {
  await db
    .update(media)
    .set({
      metadataState: state,
      // Only where nothing better is known: a capture time the browser read
      // from the file at upload wins over this one.
      ...(capturedAt ? { capturedAt: sql`COALESCE(${media.capturedAt}, ${capturedAt}::timestamp)` } : {}),
    })
    .where(eq(media.id, id));
}

export async function scrubVideo(
  payload: JobPayload<"media.scrub_video">,
  context: JobContext,
): Promise<JobOutcome> {
  const [row] = await db
    .select({
      id: media.id,
      kind: media.kind,
      mimeType: media.mimeType,
      blobPathname: media.blobPathname,
      metadataState: media.metadataState,
    })
    .from(media)
    .where(eq(media.id, payload.mediaId))
    .limit(1);
  if (!row || row.kind !== "video" || row.metadataState === "clean") return;

  // WebM comes from a browser's own recorder (the in-app camera), which writes
  // no location, and has none of the atoms this looks for.
  if (row.mimeType === "video/webm") {
    await setState(row.id, "clean", null);
    return;
  }

  if (context.deadline - Date.now() < MIN_RUNWAY_MS) return { requeue: { delayMs: 1_000 } };

  const bucket = process.env.R2_BUCKET_NAME;
  const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: row.blobPathname }));
  const size = head.ContentLength ?? 0;
  const plan = await planVideoScrub(size, rangeReader(row.blobPathname));

  if (!plan.recognised) {
    log.warn("video_scrub.unrecognised", { mediaId: row.id, mimeType: row.mimeType });
    await setState(row.id, "failed", null);
    return;
  }
  if (plan.patches.length === 0) {
    await setState(row.id, "clean", plan.capturedAt);
    return;
  }

  // Same key, so every URL and every row keeps pointing at the right object.
  // The multipart upload replaces it only on completion, after the read has
  // finished, so nothing ever sees half a file.
  const source = await r2.send(
    new GetObjectCommand({ Bucket: bucket, Key: row.blobPathname, IfMatch: head.ETag }),
  );
  if (!source.Body) throw new Error(`Video returned no body: ${row.blobPathname}`);
  await uploadStream({
    key: row.blobPathname,
    body: (source.Body as Readable).pipe(patchingStream(plan.patches)),
    contentType: head.ContentType ?? row.mimeType,
    contentDisposition: head.ContentDisposition,
  });

  // Erased while it was being rewritten: the upload just put the object back,
  // so it goes again rather than waiting for the orphan reaper.
  const [still] = await db.select({ id: media.id }).from(media).where(eq(media.id, row.id)).limit(1);
  if (!still) {
    await deleteBlobs([row.blobPathname]);
    return;
  }

  const check = await planVideoScrub(size, rangeReader(row.blobPathname));
  if (check.patches.length > 0) {
    // Should be impossible: the same plan over the patched bytes. Thrown, so
    // it retries and, if it keeps happening, lands in the dead jobs.
    throw new Error(`Location still present after scrub: ${row.id}`);
  }
  log.info("video_scrub.removed", { mediaId: row.id, removed: plan.removed });
  await setState(row.id, "clean", plan.capturedAt);
}

/** Queues a scrub for each video that has not had one, a page at a time. */
export async function backfillVideoScrubs(): Promise<JobOutcome> {
  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.kind, "video"),
        or(
          isNull(media.metadataState),
          // A pending scrub whose job was lost. An hour is far past any upload.
          and(eq(media.metadataState, "pending"), lt(media.createdAt, sql`now() - interval '1 hour'`)),
        ),
      ),
    )
    .orderBy(media.createdAt)
    .limit(200);
  for (const row of rows) {
    await enqueueVideoScrub(row.id).catch((error) => reportError("video_scrub.enqueue_failed", error));
  }
  return;
}
