import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { r2 } from "@/lib/storage";
import { log, reportError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Something an uptime monitor can poll.
 *
 * The honest gap this fills: the app can be completely broken, with the
 * database unreachable or the R2 credentials rotated out from under it, and the
 * marketing page still returns 200 because it is static. Monitoring the
 * homepage proves Vercel is up, not that Klik works. This touches the two
 * dependencies that actually matter and fails loudly when either is gone.
 *
 * **Public on purpose**, because an uptime monitor cannot authenticate, which
 * is why the body carries statuses and durations and nothing else. No versions,
 * no hostnames, no bucket names, no error text. A failing check says `"down"`
 * and the reason goes to the log, where it is already being captured.
 */

/** Both checks cost money or connections, so a burst of pollers must not turn
 *  into a burst of R2 calls. 30 seconds is below any sane monitor interval. */
const CACHE_MS = 30_000;

type CheckState = "up" | "down";

interface Snapshot {
  at: number;
  ok: boolean;
  checks: Record<string, { status: CheckState; ms: number }>;
}

let cached: Snapshot | null = null;

async function timed(
  name: string,
  check: () => Promise<unknown>,
): Promise<[string, { status: CheckState; ms: number }]> {
  const started = Date.now();
  try {
    await check();
    return [name, { status: "up", ms: Date.now() - started }];
  } catch (error) {
    // The detail goes to the log rather than the response, so the endpoint
    // cannot be used to probe how the thing is configured.
    reportError(`health.${name}_failed`, error, { ms: Date.now() - started });
    return [name, { status: "down", ms: Date.now() - started }];
  }
}

async function run(): Promise<Snapshot> {
  const results = await Promise.all([
    // Cheapest round trip that proves the pooled connection actually works,
    // rather than that the URL parses.
    timed("database", () => db.execute(sql`select 1`)),
    // One key is enough to prove the credentials and the bucket are both real.
    // Deliberately not a write: a health check must not create anything.
    timed("storage", () =>
      r2.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1 })),
    ),
    // Added after an outage this endpoint could not see.
    //
    // sharp is a native module whose linux binary was missing in production for
    // hours. Uploads were dead and this route happily returned 200, because it
    // checked the database and R2 and nothing about whether the server could
    // actually process an image. A dependency that only fails at runtime, on one
    // platform, is exactly what a health check is for.
    //
    // It encodes rather than just importing, because the import can succeed and
    // the dlopen still fail on first use. One 8x8 pixel is enough, and the
    // module stays loaded afterwards so this costs nothing on later calls.
    timed("imaging", async () => {
      const sharp = (await import("sharp")).default;
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
        .jpeg()
        .toBuffer();
    }),
  ]);

  const checks = Object.fromEntries(results);
  return {
    at: Date.now(),
    ok: Object.values(checks).every((check) => check.status === "up"),
    checks,
  };
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const previous = cached;
    cached = await run();
    // Log only on a change of state. A line every poll is noise that trains
    // you to ignore the log; a line when it flips is the thing worth seeing.
    if (!previous || previous.ok !== cached.ok) {
      log[cached.ok ? "info" : "warn"]("health.state_changed", {
        ok: cached.ok,
        checks: cached.checks,
      });
    }
  }

  return NextResponse.json(
    { ok: cached.ok, checks: cached.checks, cachedForMs: CACHE_MS },
    {
      status: cached.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
