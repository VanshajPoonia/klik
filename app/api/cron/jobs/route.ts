import { NextResponse } from "next/server";
import { drainJobs, pruneFinishedJobs } from "@/lib/job-runner";
import { scheduleDailyJobs } from "@/lib/jobs";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/**
 * The job queue's backstop. Vercel's cron hits this daily, which on Hobby is as
 * often as it may. Safe to hit far more often than that: daily work is
 * scheduled at most once per UTC day however many times this runs, so an
 * external heartbeat can poll it every minute to make retries prompt.
 *
 * Runs the drain inside the request rather than after it, so the response can
 * say what happened. A cron that only ever reports success cannot tell "nothing
 * to do" from "stopped working".
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const scheduled = await scheduleDailyJobs();
    const pruned = await pruneFinishedJobs();
    const drain = await drainJobs({ budgetMs: 240_000 });
    return NextResponse.json({ ok: true, scheduled, pruned, ...drain });
  } catch (error) {
    reportError("jobs.cron_failed", error);
    return NextResponse.json({ error: "Job cron failed" }, { status: 500 });
  }
}
