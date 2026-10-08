import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { media } from "../schema";
import { r2, thumbPathnameFor } from "../storage";
import { renderThumbnail } from "../thumbnail";
import { enqueueThumbnail, type JobPayload } from "../jobs";
import { log } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

/**
 * Makes the grid rendition for one media row.
 *
 * Idempotent, as every handler must be: a row that already has a thumbnail, or
 * no longer exists, is done. The final write is conditional on the column still
 * being empty, so a thumbnail the uploader's browser delivered in the meantime
 * is never overwritten by this one.
 *
 * Soft-deleted rows still get one. They can be restored, and a restored photo
 * should look like every other photo.
 */
export async function generateThumbnail(
  payload: JobPayload<"media.thumbnail">,
  context: JobContext,
): Promise<JobOutcome> {
  void context;
  const [row] = await db
    .select({
      id: media.id,
      eventId: media.eventId,
      kind: media.kind,
      blobPathname: media.blobPathname,
      posterPathname: media.posterPathname,
      thumbPathname: media.thumbPathname,
    })
    .from(media)
    .where(eq(media.id, payload.mediaId))
    .limit(1);
  if (!row || row.thumbPathname) return;

  // A video is thumbnailed from its poster still, never from the video. Until
  // OPS-1 a video with no poster simply has nothing to make one from.
  const sourceKey = row.kind === "video" ? row.posterPathname : row.blobPathname;
  if (!sourceKey) return;

  const object = await r2.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: sourceKey }),
  );
  if (!object.Body) throw new Error(`Source object returned no body: ${sourceKey}`);
  const source = Buffer.from(await object.Body.transformToByteArray());

  const thumbnail = await renderThumbnail(source);
  if (!thumbnail) {
    // Undecodable source. Retrying cannot change the bytes, so this is logged
    // and finished rather than thrown into three pointless attempts.
    log.warn("thumbnail.source_undecodable", { mediaId: row.id });
    return;
  }

  const key = thumbPathnameFor(row.eventId, row.id);
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: thumbnail,
      ContentType: "image/jpeg",
    }),
  );
  await db
    .update(media)
    .set({ thumbPathname: key })
    .where(and(eq(media.id, row.id), isNull(media.thumbPathname)));
}

/** How many thumbnails one backfill run queues. The rest wait for tomorrow. */
const BACKFILL_BATCH = 500;

export async function backfillThumbnails(
  payload: JobPayload<"media.backfill_thumbnails">,
  context: JobContext,
): Promise<JobOutcome> {
  void payload;
  void context;
  const missing = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        isNull(media.thumbPathname),
        or(eq(media.kind, "photo"), isNotNull(media.posterPathname)),
      ),
    )
    .limit(BACKFILL_BATCH);

  let queued = 0;
  for (const { id } of missing) {
    if ((await enqueueThumbnail(id)).enqueued) queued += 1;
  }
  log.info("thumbnail.backfill_queued", { found: missing.length, queued });
}
