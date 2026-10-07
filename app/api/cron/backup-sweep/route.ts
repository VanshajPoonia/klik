import { NextResponse } from "next/server";
import { sweepBackup } from "@/lib/backup";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Copies anything the backup bucket is missing. See `lib/backup.ts` for why the
 * backup exists at all and why this runs on a schedule rather than at upload.
 *
 * Scheduled an hour BEFORE the purge rather than after it, because the purge is
 * the thing most likely to delete something it should not have. Backing up
 * first means the night's copy is taken from a bucket the purge has not touched
 * yet, so a purge bug is recoverable from that night's backup instead of being
 * faithfully replicated into it.
 */
function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const primaryBucket = process.env.R2_BUCKET_NAME;
  if (!primaryBucket) {
    return NextResponse.json({ error: "R2_BUCKET_NAME is not set" }, { status: 500 });
  }

  try {
    // Short of maxDuration, so the function returns a report rather than being
    // killed mid-copy. A killed run loses the log line saying what is left.
    const result = await sweepBackup({ primaryBucket, budgetMs: 240_000 });
    if (!result.configured) {
      // Not an error. A deployment without a backup bucket is a valid one, and
      // saying so out loud beats a silent success that protects nothing.
      return NextResponse.json({ ok: true, skipped: "R2_BACKUP_BUCKET is not set" });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    reportError("backup.sweep_failed", error);
    return NextResponse.json({ error: "Backup sweep failed" }, { status: 500 });
  }
}
