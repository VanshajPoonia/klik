import { sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimits } from "./schema";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window rolls over. Feeds the Retry-After header. */
  retryAfter: number;
}

/**
 * Consumes one unit against `key` and reports whether the caller is still
 * under `limit` for the current fixed window.
 *
 * The increment and the window roll happen inside one INSERT ... ON CONFLICT
 * statement on purpose. Reading the count and then writing it back would let
 * two concurrent requests both observe the same pre-increment value and both
 * pass, which is precisely the case a rate limiter exists to stop, and it is
 * the shape an attacker gets for free by firing requests in parallel.
 *
 * Fixed windows rather than a sliding log: a burst can straddle a boundary and
 * briefly reach 2x the limit, which is an acceptable trade for one row and one
 * round trip per check. The alternative costs a row per request.
 */
export async function consume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowAge = sql`now() - (${windowSeconds}::int * interval '1 second')`;
  const expired = sql`${rateLimits.windowStart} < ${windowAge}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  const count = row?.count ?? 1;
  const elapsed = row ? (Date.now() - row.windowStart.getTime()) / 1000 : 0;
  const retryAfter = Math.max(1, Math.ceil(windowSeconds - elapsed));

  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter };
}

/**
 * Best-effort client address. Vercel sets x-forwarded-for; the leftmost entry
 * is the client, the rest are proxies. A spoofed header only lets an attacker
 * rate-limit themselves into a different bucket, so this is deliberately not
 * treated as trustworthy identity, only as a coarse grouping key.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Sweeps counters whose window closed long ago. Called from the purge cron. */
export async function pruneRateLimits(olderThanSeconds = 24 * 60 * 60): Promise<void> {
  await db
    .delete(rateLimits)
    .where(sql`${rateLimits.windowStart} < now() - (${olderThanSeconds}::int * interval '1 second')`);
}
