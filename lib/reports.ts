import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { events, media, mediaReports, users, type ReportReason } from "./schema";
import { sendEmail } from "./email";
import { consume } from "./ratelimit";
import { getAppUrl } from "./env";
import { log, reportError } from "./observability";
import { escapeHtml } from "./emails/theme";

/**
 * TRS-1: reporting a photo, and what a report does.
 *
 * Three behaviours, from mildest:
 * - **Every report** is recorded once per person per photo, shown to the
 *   organizer, and appears in the superadmin queue.
 * - **Three different people** reporting one photo hides it from guests until
 *   the host looks. One report is an opinion; three is a room.
 * - **A child-safety report** hides the photo from everyone at once, puts it
 *   under a legal hold, and emails the operations address as urgent. The Terms
 *   say this material is "reported rather than merely removed", and US law
 *   (18 U.S.C. 2258A) requires a provider that reports it to NCMEC to preserve
 *   it. The hold is what stops the 30-day purge, an erasure request or the
 *   uploader's own delete from destroying it first.
 */

export const HIDE_AFTER_REPORTERS = 3;

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  child_safety: "Involves a child in a sexual or abusive way",
  nudity: "Nudity or sexual content",
  violence: "Violence or something disturbing",
  harassment: "Bullying, harassment or hate",
  privacy: "It's me, and I don't want it here",
  copyright: "It's my work and was shared without permission",
  spam: "Spam or nothing to do with this event",
  other: "Something else",
};

/** Stable per person per event, and not reversible to who they are. */
export function reporterKey(eventId: string, identity: string): string {
  return createHash("sha256").update(`${eventId}:${identity}`).digest("hex").slice(0, 40);
}

export interface FiledReport {
  created: boolean;
  hidden: boolean;
  held: boolean;
}

export async function fileReport({
  eventId,
  mediaId,
  reason,
  note,
  reporter,
}: {
  eventId: string;
  mediaId: string;
  reason: ReportReason;
  note?: string | null;
  reporter: { guestId?: string | null; userId?: string | null; ip: string };
}): Promise<FiledReport | null> {
  const [item] = await db
    .select({ id: media.id, status: media.status })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, eventId), isNull(media.deletedAt)))
    .limit(1);
  if (!item) return null;

  const identity = reporter.userId
    ? `user:${reporter.userId}`
    : reporter.guestId
      ? `guest:${reporter.guestId}`
      : `ip:${reporter.ip}`;
  const inserted = await db
    .insert(mediaReports)
    .values({
      id: `rep_${nanoid()}`,
      eventId,
      mediaId,
      reporterGuestId: reporter.guestId ?? null,
      reporterUserId: reporter.userId ?? null,
      reporterKey: reporterKey(eventId, identity),
      reason,
      note: note?.trim() ? note.trim().slice(0, 500) : null,
    })
    .onConflictDoNothing()
    .returning({ id: mediaReports.id });
  const created = inserted.length > 0;

  let held = false;
  let hidden = false;
  if (reason === "child_safety") {
    // Hidden from guests and the uploader alike, and frozen. Rejected rather
    // than deleted: the bytes are evidence and must be kept.
    await db
      .update(media)
      .set({ status: "rejected", legalHoldAt: sql`COALESCE(${media.legalHoldAt}, now())` })
      .where(eq(media.id, mediaId));
    held = true;
    hidden = true;
  } else {
    const [{ open }] = await db
      .select({ open: count() })
      .from(mediaReports)
      .where(and(eq(mediaReports.mediaId, mediaId), isNull(mediaReports.resolvedAt)));
    if (open >= HIDE_AFTER_REPORTERS && item.status === "approved") {
      await db.update(media).set({ status: "pending" }).where(eq(media.id, mediaId));
      hidden = true;
    }
  }

  if (created) await notify({ eventId, mediaId, reason, hidden, held });
  log.info("reports.filed", { eventId, mediaId, reason, created, hidden, held });
  return { created, hidden, held };
}

async function notify({
  eventId,
  mediaId,
  reason,
  hidden,
  held,
}: {
  eventId: string;
  mediaId: string;
  reason: ReportReason;
  hidden: boolean;
  held: boolean;
}) {
  try {
    const [row] = await db
      .select({ eventName: events.name, ownerEmail: users.email, ownerName: users.name })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(eq(events.id, eventId))
      .limit(1);
    const appUrl = getAppUrl();
    const eventUrl = `${appUrl}/dashboard/events/${eventId}`;

    const ops = process.env.ALERT_EMAIL;
    if (held && ops) {
      await sendEmail({
        to: ops,
        subject: `URGENT: child-safety report on "${row?.eventName ?? eventId}"`,
        text: [
          "A guest reported a photo as involving a child in a sexual or abusive way.",
          "",
          "It has been hidden from everyone and put under a legal hold, so nothing will delete it.",
          `Review it on ${appUrl}/admin under Reports, today.`,
          "",
          "If it is what was reported, report it to NCMEC's CyberTipline (report.cybertip.org)",
          "and record that on /admin. Do not download, copy or forward it.",
          "",
          `Event: ${eventId}`,
          `Media: ${mediaId}`,
        ].join("\n"),
        html: `<p>A guest reported a photo as involving a child in a sexual or abusive way.</p><p>It has been hidden from everyone and put under a legal hold, so nothing will delete it. <a href="${appUrl}/admin">Review it on /admin under Reports</a>, today.</p><p>If it is what was reported, report it to NCMEC's CyberTipline (report.cybertip.org) and record that on /admin. Do not download, copy or forward it.</p><p>Event: ${eventId}<br>Media: ${mediaId}</p>`,
      });
    }

    // The organizer hears about reports, at most every six hours per event, so
    // a pile-on at midnight is one email and not twenty. Never for a
    // child-safety report: that goes to Klik, not to whoever runs the gallery.
    if (!held && row?.ownerEmail) {
      const throttle = await consume(`report-email:${eventId}`, 1, 6 * 60 * 60);
      if (throttle.allowed) {
        await sendEmail({
          to: row.ownerEmail,
          subject: `A photo in ${row.eventName} was reported`,
          text: [
            `A guest reported a photo in ${row.eventName}${hidden ? ", and it is now hidden from guests until you look at it" : ""}.`,
            `Reason given: ${REPORT_REASON_LABELS[reason]}.`,
            "",
            `Review it: ${eventUrl}`,
          ].join("\n"),
          html: `<p>A guest reported a photo in <strong>${escapeHtml(row.eventName)}</strong>${hidden ? ", and it is now hidden from guests until you look at it" : ""}.</p><p>Reason given: ${escapeHtml(REPORT_REASON_LABELS[reason])}.</p><p><a href="${eventUrl}">Review it in your dashboard</a></p>`,
        });
      }
    }
  } catch (error) {
    reportError("reports.notify_failed", error, { eventId, mediaId });
  }
}

/** Open report counts per photo, for the organizer's grid. */
export async function openReportCounts(eventId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ mediaId: mediaReports.mediaId, open: count() })
    .from(mediaReports)
    .where(and(eq(mediaReports.eventId, eventId), isNull(mediaReports.resolvedAt)))
    .groupBy(mediaReports.mediaId);
  return new Map(rows.map((row) => [row.mediaId, row.open]));
}

/**
 * Closes every open report on one photo with a resolution. The organizer can
 * do this for anything not under a legal hold; a hold is Klik's to resolve.
 */
export async function resolveReports(
  mediaId: string,
  { byUserId, resolution }: { byUserId: string; resolution: string },
): Promise<number> {
  const rows = await db
    .update(mediaReports)
    .set({ resolvedAt: sql`now()`, resolvedByUserId: byUserId, resolution: resolution.slice(0, 300) })
    .where(and(eq(mediaReports.mediaId, mediaId), isNull(mediaReports.resolvedAt)))
    .returning({ id: mediaReports.id });
  return rows.length;
}

/** Superadmin only: lift a hold, for a report that turned out to be false. */
export async function releaseLegalHold(mediaId: string): Promise<boolean> {
  const rows = await db
    .update(media)
    .set({ legalHoldAt: null })
    .where(and(eq(media.id, mediaId), isNotNull(media.legalHoldAt)))
    .returning({ id: media.id });
  return rows.length > 0;
}

/** Whether any of these media are held. Erasure refuses rather than destroy evidence. */
export async function hasLegalHold(where: { eventIds?: string[]; mediaIds?: string[] }): Promise<boolean> {
  const conditions = [isNotNull(media.legalHoldAt)];
  if (where.eventIds?.length) conditions.push(inArray(media.eventId, where.eventIds));
  if (where.mediaIds?.length) conditions.push(inArray(media.id, where.mediaIds));
  if (!where.eventIds?.length && !where.mediaIds?.length) return false;
  const [row] = await db.select({ id: media.id }).from(media).where(and(...conditions)).limit(1);
  return Boolean(row);
}

/** The superadmin queue: every photo with an open report, held first. */
export async function listOpenReports() {
  const rows = await db
    .select({
      report: mediaReports,
      eventName: events.name,
      eventSlug: events.slug,
      legalHoldAt: media.legalHoldAt,
      status: media.status,
    })
    .from(mediaReports)
    .innerJoin(events, eq(events.id, mediaReports.eventId))
    .innerJoin(media, eq(media.id, mediaReports.mediaId))
    .where(isNull(mediaReports.resolvedAt))
    .orderBy(desc(mediaReports.createdAt));

  const byMedia = new Map<
    string,
    {
      mediaId: string;
      eventId: string;
      eventName: string;
      eventSlug: string;
      held: boolean;
      status: string;
      reasons: ReportReason[];
      notes: string[];
      count: number;
      latest: Date;
    }
  >();
  for (const row of rows) {
    const existing = byMedia.get(row.report.mediaId);
    if (existing) {
      existing.count += 1;
      if (!existing.reasons.includes(row.report.reason)) existing.reasons.push(row.report.reason);
      if (row.report.note) existing.notes.push(row.report.note);
    } else {
      byMedia.set(row.report.mediaId, {
        mediaId: row.report.mediaId,
        eventId: row.report.eventId,
        eventName: row.eventName,
        eventSlug: row.eventSlug,
        held: Boolean(row.legalHoldAt),
        status: row.status,
        reasons: [row.report.reason],
        notes: row.report.note ? [row.report.note] : [],
        count: 1,
        latest: row.report.createdAt,
      });
    }
  }
  return [...byMedia.values()].sort((a, b) => Number(b.held) - Number(a.held) || b.latest.getTime() - a.latest.getTime());
}
