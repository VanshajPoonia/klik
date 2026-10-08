import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { media } from "../schema";
import { deleteBlobs, r2 } from "../storage";
import { log, reportError } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";
import type { JobPayload } from "../jobs";

/**
 * SEC-2's reaper: deletes objects under `events/` that no media row points at.
 *
 * Orphans come from two places. A guest's upload that reached the bucket but
 * never registered (they closed the tab, the registration request failed), and
 * an object whose delete failed after its row was already gone. Neither is
 * visible to the purge cron, which walks rows, so without this they would sit
 * in the bucket and on the bill forever.
 *
 * **This deletes bytes, so it is built to be wrong safely.**
 * - "Referenced" is decided against every media row for the event, soft-deleted
 *   ones included. A photo in the 30-day trash still owns its object.
 * - Nothing younger than a day is touched, which covers any upload still in
 *   flight however slow the wifi.
 * - A circuit breaker stops the walk when most of what it sees looks orphaned,
 *   because that is the shape of a bug in this query, not of real orphans.
 * - The backup bucket keeps everything it deletes for 30 more days anyway.
 */

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** The breaker trips past this many orphans when they are also the majority. */
export const BREAKER_MIN_ORPHANS = 25;

const PREFIX = "events/";

export interface ListedObject {
  key: string;
  lastModified: Date | null;
}

/** `events/<eventId>/<file>`, or null for anything that is not shaped like it. */
export function eventIdFromKey(key: string): string | null {
  const match = /^events\/([^/]+)\/[^/]+$/.exec(key);
  return match ? match[1] : null;
}

/**
 * Which of `objects` are old enough to judge, and which of those nothing
 * references. Pure, so the rule is testable without a bucket.
 *
 * An object with no LastModified is treated as new: not knowing its age is not
 * a reason to delete it.
 */
export function planOrphans(
  objects: ListedObject[],
  referenced: ReadonlySet<string>,
  now: number,
  graceMs = ORPHAN_GRACE_MS,
): { eligible: number; orphans: string[] } {
  let eligible = 0;
  const orphans: string[] = [];
  for (const object of objects) {
    if (!object.lastModified || now - object.lastModified.getTime() < graceMs) continue;
    if (!eventIdFromKey(object.key)) continue;
    eligible += 1;
    if (!referenced.has(object.key)) orphans.push(object.key);
  }
  return { eligible, orphans };
}

/** More than BREAKER_MIN_ORPHANS orphans, and more than half of what was judged. */
export function breakerTrips(scanned: number, orphaned: number): boolean {
  return orphaned > BREAKER_MIN_ORPHANS && orphaned * 2 > scanned;
}

/** Every object key any media row for these events points at, trashed rows included. */
async function referencedKeys(eventIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  if (eventIds.length === 0) return keys;
  // Deliberately no deleted_at filter. See the header.
  const rows = await db
    .select({ blob: media.blobPathname, poster: media.posterPathname })
    .from(media)
    .where(inArray(media.eventId, eventIds));
  for (const row of rows) {
    keys.add(row.blob);
    if (row.poster) keys.add(row.poster);
  }
  return keys;
}

export async function reapOrphans(
  payload: JobPayload<"uploads.reap_orphans">,
  context: JobContext,
): Promise<JobOutcome> {
  let token = payload.continuationToken;
  let scanned = payload.scanned ?? 0;
  let orphaned = payload.orphaned ?? 0;
  let deleted = 0;

  for (;;) {
    const page = await r2.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: PREFIX,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    const objects: ListedObject[] = (page.Contents ?? []).flatMap((item) =>
      item.Key ? [{ key: item.Key, lastModified: item.LastModified ?? null }] : [],
    );
    const eventIds = [...new Set(objects.map((object) => eventIdFromKey(object.key)).filter(Boolean))] as string[];
    const referenced = await referencedKeys(eventIds);
    const { eligible, orphans } = planOrphans(objects, referenced, Date.now());

    scanned += eligible;
    orphaned += orphans.length;

    if (breakerTrips(scanned, orphaned)) {
      // Abort before deleting this page. Thrown so the job retries a few times
      // and then lands in `dead`, which is what alerts a human.
      const error = new Error(
        `Orphan reaper circuit breaker: ${orphaned} of ${scanned} objects looked unreferenced`,
      );
      reportError("reaper.circuit_breaker_tripped", error, { scanned, orphaned });
      throw error;
    }

    if (orphans.length > 0) {
      if (payload.dryRun) {
        log.info("reaper.would_delete", { count: orphans.length, sample: orphans.slice(0, 20) });
      } else {
        await deleteBlobs(orphans);
        deleted += orphans.length;
        log.info("reaper.deleted", { count: orphans.length, sample: orphans.slice(0, 20) });
      }
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (!token) break;

    // Hand the rest of the walk to the next run rather than be killed mid-page.
    if (context.deadline - Date.now() < 30_000) {
      log.info("reaper.continuing", { scanned, orphaned, deleted });
      return {
        requeue: {
          payload: { continuationToken: token, dryRun: payload.dryRun, scanned, orphaned },
        },
      };
    }
  }

  log.info("reaper.completed", { scanned, orphaned, deleted, dryRun: Boolean(payload.dryRun) });
}
