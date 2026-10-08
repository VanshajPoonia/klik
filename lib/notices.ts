import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { events, users } from "./schema";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import { eventPlan } from "./license";
import { eventUsage } from "./usage";
import { formatFileSize } from "./plans";
import { log, reportError } from "./observability";

/**
 * PAY-7 and SEC-1: telling an organizer before something happens to their
 * gallery, rather than after. Each warning is sent once per threshold, recorded
 * on the event row by a conditional update, so a retried job or two uploads
 * crossing a line at the same moment cannot send it twice.
 */

async function ownerOf(eventId: string) {
  const [row] = await db
    .select({ event: events, email: users.email, name: users.name })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * Called after an upload lands. Claims the threshold first, then sends, so the
 * claim is what makes it once-only. Returns the level claimed, or null.
 */
export async function claimUsageWarning(eventId: string): Promise<75 | 90 | 100 | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return null;
  const usage = eventUsage(event, eventPlan(event));
  if (usage.level === 0 || usage.level <= event.usageWarnedPercent) return null;
  const [claimed] = await db
    .update(events)
    .set({ usageWarnedPercent: usage.level })
    .where(and(eq(events.id, eventId), lt(events.usageWarnedPercent, usage.level)))
    .returning({ id: events.id });
  return claimed ? usage.level : null;
}

export async function sendUsageWarning(eventId: string, level: 75 | 90 | 100): Promise<void> {
  const row = await ownerOf(eventId);
  if (!row?.email) return;
  const plan = eventPlan(row.event);
  const usage = eventUsage(row.event, plan);
  const url = `${getAppUrl()}/dashboard/events/${eventId}`;
  const full = level === 100;
  await sendEmail({
    ...noticeEmail({
      subject: full ? `${row.event.name} is full` : `${row.event.name} is ${level}% full`,
      heading: full ? `${row.event.name} is full` : `${row.event.name} is ${level}% full`,
      paragraphs: [
        `It holds ${formatFileSize(usage.bytes)} of its ${formatFileSize(usage.storageLimit)}, across ${usage.count} photos and videos.`,
        full
          ? "Guests cannot add anything more. They are told the gallery is full, not anything about plans. Delete a few large videos, or call us and we will make room."
          : "Nothing has stopped. This is early notice, so a busy evening does not run out of room halfway through. Videos take the most space.",
      ],
      cta: { label: "See the gallery", url },
      footer: "One email at each of 75%, 90% and full, never more.",
    }),
    to: row.email,
  });
  log.info("notices.usage_sent", { eventId, level });
}

const RETENTION_THRESHOLDS = [1, 7, 30] as const;

/** The nearest threshold `daysLeft` falls inside, or null when it is further. */
export function retentionThreshold(daysLeft: number): 1 | 7 | 30 | null {
  return RETENTION_THRESHOLDS.find((threshold) => daysLeft <= threshold) ?? null;
}

/**
 * SEC-1: before a gallery's retention runs out, warn at 30, 7 and 1 days. The
 * purge itself only soft-deletes and waits 30 more days, but the organizer's
 * gallery disappears from view on the date, and finding that out afterwards is
 * the support call this prevents. A window that moves out (a plan upgrade)
 * resets the warnings, so the new date gets its own.
 */
export async function sendRetentionWarnings(now = new Date()): Promise<{ sent: number; reset: number }> {
  // Typed explicitly: a bare parameter reaches Postgres as text, and text plus
  // an interval is not an operator, which failed the first run of this in a test.
  const at = sql`${now.toISOString()}::timestamptz`;
  const reset = await db
    .update(events)
    .set({ retentionWarnedDays: null })
    .where(
      and(
        isNotNull(events.retentionWarnedDays),
        sql`${events.retentionUntil} > ${at} + interval '30 days'`,
      ),
    )
    .returning({ id: events.id });

  const due = await db
    .select({ event: events, email: users.email })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(
      and(
        isNull(events.deletedAt),
        isNull(events.purgedAt),
        isNotNull(events.licensedAt),
        isNotNull(events.retentionUntil),
        sql`${events.retentionUntil} > ${at}`,
        sql`${events.retentionUntil} <= ${at} + interval '30 days'`,
      ),
    );

  let sent = 0;
  for (const { event, email } of due) {
    const daysLeft = Math.ceil((event.retentionUntil!.getTime() - now.getTime()) / 86_400_000);
    const threshold = retentionThreshold(daysLeft);
    if (!threshold) continue;
    if (event.retentionWarnedDays !== null && event.retentionWarnedDays <= threshold) continue;
    const [claimed] = await db
      .update(events)
      .set({ retentionWarnedDays: threshold })
      .where(
        and(
          eq(events.id, event.id),
          sql`(${events.retentionWarnedDays} IS NULL OR ${events.retentionWarnedDays} > ${threshold})`,
        ),
      )
      .returning({ id: events.id });
    if (!claimed || !email) continue;
    try {
      const date = event.retentionUntil!.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      await sendEmail({
        ...noticeEmail({
          subject: daysLeft <= 1 ? `${event.name} closes tomorrow` : `${event.name} closes in ${daysLeft} days`,
          heading: `Download ${event.name} before ${date}`,
          paragraphs: [
            `Your plan keeps this gallery for a set time, and it ends on ${date}. After that the gallery closes and its photos and videos are removed.`,
            "Download everything now from your dashboard. It takes a minute to start, and big galleries are packed into ZIP files and emailed to you when ready.",
          ],
          cta: { label: "Download it", url: `${getAppUrl()}/dashboard/events/${event.id}` },
          footer: "Sent 30 days, 7 days and 1 day before a gallery closes.",
        }),
        to: email,
      });
      sent += 1;
    } catch (error) {
      reportError("notices.retention_failed", error, { eventId: event.id });
    }
  }
  if (sent || reset.length) log.info("notices.retention", { sent, reset: reset.length });
  return { sent, reset: reset.length };
}

/** F-4's nightly reconcile: recompute the counters from the rows, so drift heals. */
export async function reconcileUsage(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE events e
    SET media_count = COALESCE(s.c, 0), media_bytes = COALESCE(s.b, 0)
    FROM (
      SELECT ev.id, count(m.id) AS c, sum(m.size_bytes) AS b
      FROM events ev
      LEFT JOIN media m ON m.event_id = ev.id AND m.deleted_at IS NULL
      GROUP BY ev.id
    ) s
    WHERE e.id = s.id AND (e.media_count <> COALESCE(s.c, 0) OR e.media_bytes <> COALESCE(s.b, 0))
  `);
  const changed = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (changed) log.warn("usage.reconcile_drift", { changed });
  return changed;
}
