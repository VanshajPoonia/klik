import { CopyObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2 } from "./storage";
import { log, reportError } from "./observability";

/**
 * Copying the media bucket into a second, locked bucket.
 *
 * **Why this exists.** R2 has no object versioning, so there is no undo for a
 * delete. Two paths issue real deletes against the primary bucket, `deleteBlobs`
 * from the retention purge and the same function from `lib/erasure.ts`, and a
 * bug in either destroys the only copy of somebody's wedding. Until 2026-10-07
 * the old EU bucket was an accidental second copy; OPS-4 removed it.
 *
 * **Why a sweep rather than a copy at upload.** A copy inside the upload
 * registration request would put a 200 MB video on the critical path of a guest
 * standing at a party, and a failure there would either lose the backup silently
 * or fail an upload that actually succeeded. A nightly sweep is allowed to be
 * slow and allowed to retry, and the thing it protects against is a deletion
 * bug rather than hardware loss, so a window of up to a day is the right trade.
 *
 * **Why the copy is server side.** Both buckets are in the same account and the
 * same jurisdiction, so `CopyObject` moves the bytes inside R2 and nothing
 * passes through this function. That is what makes a 54 MB video a 7 second
 * call rather than a memory problem.
 *
 * **What this deliberately never does is delete.** The backup is protected by
 * Bucket Lock, so it could not delete even if asked, and ageing out is the
 * lifecycle rule's job. An erasure request clears the primary immediately and
 * the backup copy expires on the rotation; see `ARCHITECTURE.md`.
 */

/** Absent configuration is a normal state here, the same as in `lib/email.ts`. */
export const BACKUP_BUCKET = process.env.R2_BACKUP_BUCKET ?? null;

export interface BackupObject {
  key: string;
  size: number;
}

export type BackupSweepResult =
  | { configured: false }
  | {
      configured: true;
      primaryCount: number;
      backupCount: number;
      copied: number;
      failed: number;
      /** Still missing when the run stopped. Non-zero means the next run continues. */
      remaining: number;
      budgetExhausted: boolean;
    };

/**
 * Which keys the backup is missing, newest-largest-last so a run that runs out
 * of budget has still protected as many distinct objects as it could.
 *
 * Pure, so the decision can be tested without a bucket. A size mismatch counts
 * as missing: a truncated copy is worse than an absent one, because it looks
 * like protection.
 */
export function planBackupCopies(
  primary: BackupObject[],
  backup: BackupObject[],
): string[] {
  const have = new Map(backup.map((object) => [object.key, object.size]));
  return primary
    .filter((object) => have.get(object.key) !== object.size)
    .sort((a, b) => a.size - b.size)
    .map((object) => object.key);
}

/**
 * What gets backed up: the media people uploaded and nothing derived from it.
 * Exports under `exports/` are ZIP copies that expire in a week and can be
 * rebuilt in minutes, so backing them up would pay twice to keep a copy of a
 * copy, and keep it 30 days past the point it was meant to be gone.
 */
export const BACKUP_PREFIXES = ["events/"] as const;

async function listAll(bucket: string): Promise<BackupObject[]> {
  const objects: BackupObject[] = [];
  for (const prefix of BACKUP_PREFIXES) objects.push(...(await listPrefix(bucket, prefix)));
  return objects;
}

async function listPrefix(bucket: string, prefix: string): Promise<BackupObject[]> {
  const objects: BackupObject[] = [];
  let token: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key && typeof object.Size === "number") {
        objects.push({ key: object.Key, size: object.Size });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

/**
 * Copy everything the backup is missing, within a time budget.
 *
 * The budget exists because the work is unbounded in principle and the function
 * is not. Stopping early and reporting `remaining` is correct behaviour: the
 * sweep is idempotent, so the next run continues rather than restarting.
 */
export async function sweepBackup({
  primaryBucket,
  budgetMs = 240_000,
  now = () => Date.now(),
}: {
  primaryBucket: string;
  budgetMs?: number;
  now?: () => number;
}): Promise<BackupSweepResult> {
  if (!BACKUP_BUCKET) return { configured: false };

  const startedAt = now();
  const [primary, backup] = await Promise.all([
    listAll(primaryBucket),
    listAll(BACKUP_BUCKET),
  ]);
  const missing = planBackupCopies(primary, backup);

  let copied = 0;
  let failed = 0;
  let index = 0;
  for (; index < missing.length; index += 1) {
    if (now() - startedAt > budgetMs) break;
    const key = missing[index];
    try {
      await r2.send(
        new CopyObjectCommand({
          Bucket: BACKUP_BUCKET,
          Key: key,
          CopySource: `${primaryBucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
        }),
      );
      copied += 1;
    } catch (error) {
      // One unreadable object must not stop the run. The common cause is an
      // overwrite refused by Bucket Lock, which means the backup already holds
      // a different version of this key and is doing its job.
      failed += 1;
      reportError("backup.copy_failed", error, { key });
    }
  }

  const budgetExhausted = index < missing.length;
  log.info("backup.sweep", {
    primaryCount: primary.length,
    backupCount: backup.length,
    copied,
    failed,
    remaining: missing.length - index,
    budgetExhausted,
  });

  return {
    configured: true,
    primaryCount: primary.length,
    backupCount: backup.length,
    copied,
    failed,
    remaining: missing.length - index,
    budgetExhausted,
  };
}
