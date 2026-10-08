import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { events, media, mediaExports, users } from "../schema";
import { r2 } from "../storage";
import { zipEntryName } from "../download-batches";
import { uploadStream } from "../multipart-upload";
import { exportPartKey, markExportFailed, recordPartBuilt } from "../exports";
import { sendEmail } from "../email";
import { exportReadyEmail } from "../emails/export-ready";
import { getAppUrl } from "../env";
import { log, reportError } from "../observability";
import type { JobPayload } from "../jobs";
import type { JobContext, JobOutcome } from "../job-runner";

/**
 * Builds one part of an export: reads each photo out of R2, writes it into a
 * ZIP, and streams the ZIP back into R2 with a multipart upload. Nothing passes
 * through the organizer's connection, which is the whole point: the old
 * streamed ZIP had to fit a download into one function's five minutes, and a
 * 1.8 GB part on ordinary home broadband does not.
 *
 * Stored, not compressed (`level: 0`), like the streamed ZIP. Photos and video
 * are already compressed, so deflating them again costs CPU for nothing.
 */
export async function buildExportPart(
  payload: JobPayload<"export.part">,
  context: JobContext,
): Promise<JobOutcome> {
  const [row] = await db.select().from(mediaExports).where(eq(mediaExports.id, payload.exportId)).limit(1);
  if (!row || row.status !== "building") return;
  const part = row.parts[payload.part];
  if (!part || part.key) return;

  try {
    // Re-read at build time: anything deleted, hidden from the gallery or
    // un-approved since the export was asked for is left out.
    const rows = part.items.length
      ? await db
          .select({
            id: media.id,
            kind: media.kind,
            mimeType: media.mimeType,
            blobPathname: media.blobPathname,
          })
          .from(media)
          .where(
            and(
              inArray(media.id, part.items),
              eq(media.eventId, row.eventId),
              eq(media.status, "approved"),
              isNull(media.deletedAt),
            ),
          )
      : [];
    const byId = new Map(rows.map((item) => [item.id, item]));
    // Numbered across the whole export, so part 2 continues where part 1 ended.
    const offset = row.parts.slice(0, payload.part).reduce((total, previous) => total + previous.items.length, 0);

    const output = new PassThrough();
    const archive = new ZipArchive({ zlib: { level: 0 } });
    archive.on("error", (error) => output.destroy(error));
    archive.pipe(output);

    const key = exportPartKey(row.eventId, row.id, payload.part + 1);
    const upload = uploadStream({ key, body: output, contentType: "application/zip" });

    let files = 0;
    try {
      for (const [index, id] of part.items.entries()) {
        const item = byId.get(id);
        if (!item) continue;
        const object = await r2.send(
          new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: item.blobPathname }),
        );
        if (!object.Body || !(object.Body instanceof Readable)) {
          throw new Error(`Media object ${item.id} did not return a readable body`);
        }
        const consumed = once(object.Body, "end");
        archive.append(object.Body, { name: zipEntryName(offset + index, item) });
        await consumed;
        files += 1;
      }
      await archive.finalize();
    } catch (error) {
      // End the stream with the error, or the upload waits for bytes that are
      // never coming and holds the job until the function is killed. Ending it
      // makes the upload abort, so R2 keeps no half-written parts either.
      output.destroy(error instanceof Error ? error : new Error(String(error)));
      await upload.catch(() => {});
      throw error;
    }
    const { bytes } = await upload;

    const ready = await recordPartBuilt(row.id, payload.part, { key, bytes, files });
    log.info("exports.part_built", { exportId: row.id, part: payload.part + 1, files, bytes });
    if (ready) await notifyReady(ready.id);
  } catch (error) {
    // The last attempt failing means the export as a whole has failed, which
    // is what the dashboard needs to show rather than a spinner for ever.
    if (context.attempt >= context.maxAttempts) {
      await markExportFailed(row.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

/** Emails whoever asked for the export. Never throws: the export is ready
 *  either way, and the dashboard shows it whether or not the mail arrived. */
async function notifyReady(exportId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ export: mediaExports, eventName: events.name, email: users.email, name: users.name })
      .from(mediaExports)
      .innerJoin(events, eq(events.id, mediaExports.eventId))
      .leftJoin(users, eq(users.id, mediaExports.requestedByUserId))
      .where(eq(mediaExports.id, exportId))
      .limit(1);
    if (!row?.email) return;
    const appUrl = getAppUrl();
    await sendEmail({
      ...exportReadyEmail({
        name: row.name,
        eventName: row.eventName,
        partCount: row.export.partCount,
        totalBytes: row.export.totalBytes,
        expiresAt: row.export.expiresAt,
        eventUrl: `${appUrl}/dashboard/events/${row.export.eventId}`,
        appUrl,
      }),
      to: row.email,
    });
  } catch (error) {
    reportError("exports.notify_failed", error, { exportId });
  }
}
