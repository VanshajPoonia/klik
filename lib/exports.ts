import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { mediaExports, type ExportPart, type MediaExport } from "./schema";
import { buildDownloadBatches } from "./download-batches";
import { deleteBlobs, r2 } from "./storage";
import { enqueue } from "./jobs";
import { log } from "./observability";

/**
 * MED-7: background ZIP exports. See `mediaExports` in lib/schema.ts for the
 * shape and lib/job-handlers/export.ts for the building.
 *
 * An export is a snapshot of which media ids go in each part, taken when it is
 * asked for, so the parts are stable however the gallery changes while they
 * build. Anything deleted in the meantime is left out at build time rather than
 * shipped, because a ZIP should not resurrect a photo the host just removed.
 */

/** How long a finished export can be downloaded before it is deleted. */
export const EXPORT_TTL_DAYS = 7;

export const EXPORT_PREFIX = "exports/";

export function exportPartKey(eventId: string, exportId: string, partNumber: number): string {
  return `${EXPORT_PREFIX}${eventId}/${exportId}/part-${partNumber}.zip`;
}

export async function createExport({
  eventId,
  requestedByUserId,
  label,
  items,
}: {
  eventId: string;
  requestedByUserId: string | null;
  label: string;
  items: Array<{ id: string; sizeBytes: number }>;
}): Promise<MediaExport> {
  const batches = buildDownloadBatches(items);
  const parts: ExportPart[] = batches.map((batch) => ({
    items: batch.map((item) => item.id),
    key: null,
    bytes: 0,
    files: 0,
  }));
  const id = `exp_${nanoid()}`;

  const [row] = await db
    .insert(mediaExports)
    .values({
      id,
      eventId,
      requestedByUserId,
      label,
      partCount: parts.length,
      parts,
    })
    .returning();

  for (let index = 0; index < parts.length; index += 1) {
    await enqueue("export.part", { exportId: id, part: index }, { dedupeKey: `export:${id}:${index}`, maxAttempts: 3 });
  }
  log.info("exports.created", { exportId: id, eventId, parts: parts.length, items: items.length });
  return row;
}

export async function listExports(eventId: string, limit = 10): Promise<MediaExport[]> {
  return db
    .select()
    .from(mediaExports)
    .where(eq(mediaExports.eventId, eventId))
    .orderBy(desc(mediaExports.createdAt))
    .limit(limit);
}

/**
 * Records one finished part, once. The `key IS NULL` guard is what makes a
 * retried part job harmless: a part that already landed cannot be counted
 * twice, so `parts_done` reaching `part_count` really does mean every part.
 *
 * Returns the export when this part was the last one, so the caller can tell
 * the organizer exactly once.
 */
export async function recordPartBuilt(
  exportId: string,
  partIndex: number,
  built: { key: string; bytes: number; files: number },
): Promise<MediaExport | null> {
  const path = `{${partIndex}}`;
  const [updated] = await db
    .update(mediaExports)
    .set({
      parts: sql`jsonb_set(
        ${mediaExports.parts},
        ${path}::text[],
        (${mediaExports.parts}->(${partIndex})::int) || ${JSON.stringify(built)}::jsonb
      )`,
      partsDone: sql`${mediaExports.partsDone} + 1`,
      totalBytes: sql`${mediaExports.totalBytes} + ${built.bytes}`,
    })
    .where(
      and(
        eq(mediaExports.id, exportId),
        eq(mediaExports.status, "building"),
        sql`(${mediaExports.parts}->(${partIndex})::int)->>'key' IS NULL`,
      ),
    )
    .returning({ partsDone: mediaExports.partsDone, partCount: mediaExports.partCount });
  if (!updated || updated.partsDone < updated.partCount) return null;

  const [ready] = await db
    .update(mediaExports)
    .set({
      status: "ready",
      completedAt: sql`now()`,
      expiresAt: sql`now() + (${EXPORT_TTL_DAYS}::int * interval '1 day')`,
    })
    .where(and(eq(mediaExports.id, exportId), eq(mediaExports.status, "building")))
    .returning();
  return ready ?? null;
}

export async function markExportFailed(exportId: string, error: string): Promise<void> {
  await db
    .update(mediaExports)
    .set({ status: "failed", error: error.slice(0, 500), completedAt: sql`now()` })
    .where(and(eq(mediaExports.id, exportId), eq(mediaExports.status, "building")));
}

/** The keys an export has written so far. */
function builtKeys(rows: MediaExport[]): string[] {
  return rows.flatMap((row) => row.parts.map((part) => part.key).filter((key): key is string => Boolean(key)));
}

/**
 * Removes every export of these events, objects first. Erasure calls this: a
 * ZIP of someone's photos is those photos, and an erasure that left the ZIP in
 * the bucket for a week would not be an erasure.
 */
export async function deleteEventExports(eventIds: string[]): Promise<number> {
  if (eventIds.length === 0) return 0;
  const rows = await db.select().from(mediaExports).where(inArray(mediaExports.eventId, eventIds));
  await deleteBlobs(builtKeys(rows));
  if (rows.length > 0) {
    await db.delete(mediaExports).where(inArray(mediaExports.eventId, eventIds));
  }
  return rows.length;
}

/**
 * The daily tidy, in three passes that each cover a different way an export
 * outlives its welcome:
 *
 * 1. Ready exports past their expiry: objects deleted, row marked expired so
 *    the dashboard can say so instead of offering a dead link.
 * 2. Exports stuck building for a day: a job that died without saying so.
 * 3. Any object under `exports/` older than the TTL plus a day, row or no row.
 *    Exports are copies by definition, so age alone is reason enough, and this
 *    is what catches the bytes of an event whose rows cascaded away.
 */
export async function expireExports(now = new Date()): Promise<{ expired: number; stuck: number; swept: number }> {
  const due = await db
    .select()
    .from(mediaExports)
    .where(and(eq(mediaExports.status, "ready"), lt(mediaExports.expiresAt, now)));
  await deleteBlobs(builtKeys(due));
  if (due.length > 0) {
    await db
      .update(mediaExports)
      .set({ status: "expired" })
      .where(inArray(mediaExports.id, due.map((row) => row.id)));
  }

  const stuck = await db
    .update(mediaExports)
    .set({ status: "failed", error: "Stopped building without finishing", completedAt: sql`now()` })
    .where(and(eq(mediaExports.status, "building"), lt(mediaExports.createdAt, sql`now() - interval '1 day'`)))
    .returning({ id: mediaExports.id });

  const cutoff = now.getTime() - (EXPORT_TTL_DAYS + 1) * 24 * 60 * 60 * 1000;
  const stale: string[] = [];
  let token: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: EXPORT_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key?.startsWith(EXPORT_PREFIX) && object.LastModified && object.LastModified.getTime() < cutoff) {
        stale.push(object.Key);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  await deleteBlobs(stale);

  const result = { expired: due.length, stuck: stuck.length, swept: stale.length };
  if (result.expired || result.stuck || result.swept) log.info("exports.expired", result);
  return result;
}
