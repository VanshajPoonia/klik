import { after, NextResponse } from "next/server";
import { drainJobs } from "@/lib/job-runner";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";
// The drain runs after the response, and `after` work is bounded by the same
// limit, so this is the time the queue actually gets. 300 is Hobby's ceiling.
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/**
 * Drains the job queue. Hit by `kickJobRunner()` right after something is
 * enqueued, which on the Hobby plan is what makes background work prompt at
 * all. See lib/jobs.ts.
 *
 * Answers 202 before doing anything, so the function that kicked it can finish
 * immediately instead of waiting on work it does not care about.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      await drainJobs({ budgetMs: 280_000 });
    } catch (error) {
      reportError("jobs.drain_failed", error);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
