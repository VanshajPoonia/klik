import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { commentReports, events, mediaComments, users, type ReportReason } from "./schema";
import { reporterKey } from "./reports";
import { sendEmail } from "./email";
import { consume } from "./ratelimit";
import { getAppUrl } from "./env";
import { log, reportError } from "./observability";
import { escapeHtml } from "./emails/theme";

/**
 * MED-9: comments under a photo or video.
 *
 * **An account is required to write one.** Free text from anonymous strangers
 * is a moderation queue somebody has to staff, and the host did not sign up to
 * staff one. Reading needs only what viewing the item needs.
 *
 * Three ways a comment comes down, each recorded in `hidden_reason`:
 * - `host`: anyone on the team who can moderate hid it. They can show it again.
 * - `reports`: three different people reported it, or one reported it as
 *   involving a child. Hidden until someone looks. The host can show it again,
 *   except after a child-safety report, which is Klik's to resolve.
 * - `klik`: hidden from the reports queue on /admin. Only Klik shows it again.
 *
 * A hidden comment stays visible to whoever wrote it, marked, for the same
 * reason a guest keeps seeing their own hidden photo: silently vanishing reads
 * as a bug, and a hidden comment is not a deleted one.
 */

export const COMMENT_MAX_LENGTH = 500;
export const HIDE_COMMENT_AFTER_REPORTERS = 3;
/** The most of one thread a viewer is sent. The newest, shown oldest first. */
export const COMMENTS_PER_ITEM = 200;

/** Reasons offered for a comment. Copyright fits a photo, not a sentence. */
export const COMMENT_REPORT_REASONS = [
  "harassment",
  "nudity",
  "privacy",
  "spam",
  "child_safety",
  "other",
] as const satisfies readonly ReportReason[];
export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];

export const COMMENT_REPORT_LABELS: Record<CommentReportReason, string> = {
  harassment: "Bullying, harassment or hate",
  nudity: "Sexual or explicit",
  privacy: "It's about me, and I don't want it here",
  spam: "Spam or nothing to do with this event",
  child_safety: "Suggests a child is being exploited or put at risk",
  other: "Something else",
};

/**
 * What is stored, from what was typed: normalised, control characters out,
 * line endings unified, runs of blank lines squeezed, trimmed. Null when
 * nothing is left or it is too long, so the route can say which.
 */
export function cleanCommentBody(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // C0 and C1 controls except newline and tab, plus the bidi overrides that
    // can make a comment read differently from what it says.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0 || cleaned.length > COMMENT_MAX_LENGTH) return null;
  return cleaned;
}

export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; team: boolean };
  mine: boolean;
  /** Present only for the team and for the author; null when visible. */
  hidden: "host" | "reports" | "klik" | null;
  /** The team only. */
  openReports?: number;
  /** The team only: a child-safety report is open, so only Klik can show it. */
  safetyHold?: boolean;
}

/**
 * The name shown on a comment. A guest's name at this event first, which is
 * the one they chose for this gallery; their account name next; never their
 * username, which since ID-1 is generated from the email address and would
 * show part of it to every guest. The team is named from their account.
 */
export function commentAuthorName(row: {
  team: boolean;
  userName: string | null;
  guestName: string | null;
}): string {
  const userName = row.userName?.trim() || null;
  const guestName = row.guestName?.trim() || null;
  if (row.team) return userName ?? guestName ?? "Host";
  return guestName ?? userName ?? "Guest";
}

/**
 * Columns every comment read needs, so listing and writing agree on names.
 *
 * The correlated subqueries here and below name `"media_comments"` outright
 * rather than interpolating the column. In the select list of a query that
 * reads one table, Drizzle writes columns without their table, and an
 * unqualified `"id"` or `"user_id"` inside a subquery binds to the subquery's
 * own table: `r."comment_id" = "id"` compared a report with itself, and the
 * child-safety check never matched. See ARCHITECTURE.md constraint 9.
 */
function commentColumns(eventOwnerId: string) {
  return {
    id: mediaComments.id,
    body: mediaComments.body,
    createdAt: mediaComments.createdAt,
    userId: mediaComments.userId,
    hiddenReason: mediaComments.hiddenReason,
    userName: users.name,
    guestName: sql<string | null>`(
      SELECT g."display_name" FROM "guests" g
      WHERE g."user_id" = "media_comments"."user_id" AND g."event_id" = "media_comments"."event_id"
        AND g."display_name" IS NOT NULL AND g."display_name" <> ''
      ORDER BY g."created_at" DESC LIMIT 1
    )`,
    team: sql<boolean>`(
      "media_comments"."user_id" = ${eventOwnerId}
      OR EXISTS (
        SELECT 1 FROM "event_co_hosts" h
        WHERE h."event_id" = "media_comments"."event_id" AND h."user_id" = "media_comments"."user_id"
          AND h."deleted_at" IS NULL
      )
    )`,
    openReports: sql<number>`(
      SELECT count(*) FROM "comment_reports" r
      WHERE r."comment_id" = "media_comments"."id" AND r."resolved_at" IS NULL
    )`.mapWith(Number),
    safetyHold: sql<boolean>`EXISTS (
      SELECT 1 FROM "comment_reports" r
      WHERE r."comment_id" = "media_comments"."id" AND r."resolved_at" IS NULL AND r."reason" = 'child_safety'
    )`,
  };
}

type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  userId: string;
  hiddenReason: "host" | "reports" | "klik" | null;
  userName: string | null;
  guestName: string | null;
  team: boolean;
  openReports: number;
  safetyHold: boolean;
};

function toView(row: CommentRow, viewer: { userId: string | null; isManager: boolean }): CommentView {
  const mine = viewer.userId !== null && row.userId === viewer.userId;
  const view: CommentView = {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { name: commentAuthorName(row), team: Boolean(row.team) },
    mine,
    hidden: viewer.isManager || mine ? row.hiddenReason : null,
  };
  if (viewer.isManager) {
    view.openReports = row.openReports;
    view.safetyHold = Boolean(row.safetyHold);
  }
  return view;
}

/**
 * One item's thread, as this viewer may see it: everything for the team,
 * visible comments plus their own for everyone else.
 */
export async function listComments({
  eventId,
  eventOwnerId,
  mediaId,
  viewer,
}: {
  eventId: string;
  eventOwnerId: string;
  mediaId: string;
  viewer: { userId: string | null; isManager: boolean };
}): Promise<CommentView[]> {
  const conditions = [eq(mediaComments.eventId, eventId), eq(mediaComments.mediaId, mediaId)];
  if (!viewer.isManager) {
    conditions.push(
      viewer.userId
        ? or(isNull(mediaComments.hiddenAt), eq(mediaComments.userId, viewer.userId))!
        : isNull(mediaComments.hiddenAt),
    );
  }
  const rows = await db
    .select(commentColumns(eventOwnerId))
    .from(mediaComments)
    .innerJoin(users, eq(users.id, mediaComments.userId))
    .where(and(...conditions))
    .orderBy(desc(mediaComments.createdAt), desc(mediaComments.id))
    .limit(COMMENTS_PER_ITEM);
  return rows.reverse().map((row) => toView(row as CommentRow, viewer));
}

export async function addComment({
  eventId,
  eventOwnerId,
  mediaId,
  userId,
  body,
  isManager,
}: {
  eventId: string;
  eventOwnerId: string;
  mediaId: string;
  userId: string;
  body: string;
  isManager: boolean;
}): Promise<CommentView> {
  const id = `cmt_${nanoid()}`;
  await db.insert(mediaComments).values({ id, eventId, mediaId, userId, body });
  const [row] = await db
    .select(commentColumns(eventOwnerId))
    .from(mediaComments)
    .innerJoin(users, eq(users.id, mediaComments.userId))
    .where(eq(mediaComments.id, id))
    .limit(1);
  log.info("comments.added", { eventId, mediaId });
  return toView(row as CommentRow, { userId, isManager });
}

/** The author removes their own comment. Deleted, not hidden: it is theirs. */
export async function deleteOwnComment(commentId: string, mediaId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(mediaComments)
    .where(
      and(eq(mediaComments.id, commentId), eq(mediaComments.mediaId, mediaId), eq(mediaComments.userId, userId)),
    )
    .returning({ id: mediaComments.id });
  return rows.length > 0;
}

async function resolveCommentReports(commentId: string, byUserId: string, resolution: string) {
  await db
    .update(commentReports)
    .set({ resolvedAt: sql`now()`, resolvedByUserId: byUserId, resolution: resolution.slice(0, 300) })
    .where(and(eq(commentReports.commentId, commentId), isNull(commentReports.resolvedAt)));
}

export type ModerateOutcome = "hidden" | "shown" | "kept" | "not_found" | "klik_only";

/**
 * The team's two verbs. `hide` takes a comment down; `show` puts back one the
 * team or reports took down, and on a visible comment with open reports it
 * means "looked at it, it stays". Either way the open reports are answered.
 */
export async function moderateComment({
  eventId,
  mediaId,
  commentId,
  action,
  byUserId,
}: {
  eventId: string;
  mediaId: string;
  commentId: string;
  action: "hide" | "show";
  byUserId: string;
}): Promise<ModerateOutcome> {
  const [comment] = await db
    .select({
      id: mediaComments.id,
      hiddenReason: mediaComments.hiddenReason,
      safetyHold: sql<boolean>`EXISTS (
        SELECT 1 FROM "comment_reports" r
        WHERE r."comment_id" = "media_comments"."id" AND r."resolved_at" IS NULL AND r."reason" = 'child_safety'
      )`,
    })
    .from(mediaComments)
    .where(
      and(eq(mediaComments.id, commentId), eq(mediaComments.eventId, eventId), eq(mediaComments.mediaId, mediaId)),
    )
    .limit(1);
  if (!comment) return "not_found";

  if (action === "hide") {
    if (!comment.hiddenReason) {
      await db
        .update(mediaComments)
        .set({ hiddenAt: sql`now()`, hiddenByUserId: byUserId, hiddenReason: "host" })
        .where(eq(mediaComments.id, commentId));
    }
    // A child-safety report stays open for Klik even when the host hides it.
    if (!comment.safetyHold) await resolveCommentReports(commentId, byUserId, "Hidden by the host.");
    return "hidden";
  }

  if (comment.hiddenReason === "klik" || comment.safetyHold) return "klik_only";
  if (comment.hiddenReason) {
    await db
      .update(mediaComments)
      .set({ hiddenAt: null, hiddenByUserId: null, hiddenReason: null })
      .where(eq(mediaComments.id, commentId));
  }
  await resolveCommentReports(
    commentId,
    byUserId,
    comment.hiddenReason ? "Shown again by the host." : "Kept by the host.",
  );
  return comment.hiddenReason ? "shown" : "kept";
}

export interface FiledCommentReport {
  created: boolean;
  hidden: boolean;
}

export async function fileCommentReport({
  eventId,
  commentId,
  reason,
  note,
  reporter,
}: {
  eventId: string;
  commentId: string;
  reason: CommentReportReason;
  note?: string | null;
  reporter: { guestId?: string | null; userId?: string | null; ip: string };
}): Promise<FiledCommentReport> {
  const identity = reporter.userId
    ? `user:${reporter.userId}`
    : reporter.guestId
      ? `guest:${reporter.guestId}`
      : `ip:${reporter.ip}`;
  const inserted = await db
    .insert(commentReports)
    .values({
      id: `crep_${nanoid()}`,
      eventId,
      commentId,
      reporterGuestId: reporter.guestId ?? null,
      reporterUserId: reporter.userId ?? null,
      reporterKey: reporterKey(eventId, identity),
      reason,
      note: note?.trim() ? note.trim().slice(0, 500) : null,
    })
    .onConflictDoNothing()
    .returning({ id: commentReports.id });
  const created = inserted.length > 0;

  let hide = reason === "child_safety";
  if (!hide) {
    const [{ open }] = await db
      .select({ open: count() })
      .from(commentReports)
      .where(and(eq(commentReports.commentId, commentId), isNull(commentReports.resolvedAt)));
    hide = open >= HIDE_COMMENT_AFTER_REPORTERS;
  }
  let hidden = false;
  if (hide) {
    const rows = await db
      .update(mediaComments)
      .set({ hiddenAt: sql`now()`, hiddenByUserId: null, hiddenReason: "reports" })
      .where(and(eq(mediaComments.id, commentId), isNull(mediaComments.hiddenAt)))
      .returning({ id: mediaComments.id });
    hidden = rows.length > 0 || reason === "child_safety";
  }

  if (created) await notifyCommentReport({ eventId, commentId, reason, hidden });
  log.info("comment_reports.filed", { eventId, commentId, reason, created, hidden });
  return { created, hidden };
}

async function notifyCommentReport({
  eventId,
  commentId,
  reason,
  hidden,
}: {
  eventId: string;
  commentId: string;
  reason: CommentReportReason;
  hidden: boolean;
}) {
  try {
    const [row] = await db
      .select({ eventName: events.name, ownerEmail: users.email })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(eq(events.id, eventId))
      .limit(1);
    const appUrl = getAppUrl();

    const ops = process.env.ALERT_EMAIL;
    if (reason === "child_safety" && ops) {
      await sendEmail({
        to: ops,
        subject: `URGENT: child-safety report on a comment in "${row?.eventName ?? eventId}"`,
        text: [
          "Someone reported a comment as suggesting a child is being exploited or put at risk.",
          "",
          "It has been hidden from everyone. The host cannot show it again; only Klik can.",
          `Review it on ${appUrl}/admin under Reports, today.`,
          "",
          `Event: ${eventId}`,
          `Comment: ${commentId}`,
        ].join("\n"),
        html: `<p>Someone reported a comment as suggesting a child is being exploited or put at risk.</p><p>It has been hidden from everyone. The host cannot show it again; only Klik can. <a href="${appUrl}/admin">Review it on /admin under Reports</a>, today.</p><p>Event: ${eventId}<br>Comment: ${commentId}</p>`,
      });
    }

    // Shares the photo reports' throttle, so a pile-on is one email to the
    // host every six hours whatever was reported.
    if (reason !== "child_safety" && row?.ownerEmail) {
      const throttle = await consume(`report-email:${eventId}`, 1, 6 * 60 * 60);
      if (throttle.allowed) {
        const eventUrl = `${appUrl}/dashboard/events/${eventId}`;
        await sendEmail({
          to: row.ownerEmail,
          subject: `A comment in ${row.eventName} was reported`,
          text: [
            `A guest reported a comment in ${row.eventName}${hidden ? ", and it is now hidden until you look at it" : ""}.`,
            `Reason given: ${COMMENT_REPORT_LABELS[reason]}.`,
            "",
            `Review it: ${eventUrl}`,
          ].join("\n"),
          html: `<p>A guest reported a comment in <strong>${escapeHtml(row.eventName)}</strong>${hidden ? ", and it is now hidden until you look at it" : ""}.</p><p>Reason given: ${escapeHtml(COMMENT_REPORT_LABELS[reason])}.</p><p><a href="${eventUrl}">Review it in your dashboard</a></p>`,
        });
      }
    }
  } catch (error) {
    reportError("comment_reports.notify_failed", error, { eventId, commentId });
  }
}

export interface ReportedComment {
  commentId: string;
  mediaId: string;
  body: string;
  authorName: string;
  hidden: "host" | "reports" | "klik" | null;
  reasons: string[];
  notes: string[];
  count: number;
  safetyHold: boolean;
  latest: Date;
}

async function groupOpenReports(where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      commentId: commentReports.commentId,
      eventId: commentReports.eventId,
      reason: commentReports.reason,
      note: commentReports.note,
      createdAt: commentReports.createdAt,
      mediaId: mediaComments.mediaId,
      body: mediaComments.body,
      hiddenReason: mediaComments.hiddenReason,
      userName: users.name,
      guestName: sql<string | null>`(
        SELECT g."display_name" FROM "guests" g
        WHERE g."user_id" = "media_comments"."user_id" AND g."event_id" = "media_comments"."event_id"
          AND g."display_name" IS NOT NULL AND g."display_name" <> ''
        ORDER BY g."created_at" DESC LIMIT 1
      )`,
      eventName: events.name,
      eventSlug: events.slug,
      ownerId: events.ownerId,
      authorId: mediaComments.userId,
    })
    .from(commentReports)
    .innerJoin(mediaComments, eq(mediaComments.id, commentReports.commentId))
    .innerJoin(users, eq(users.id, mediaComments.userId))
    .innerJoin(events, eq(events.id, commentReports.eventId))
    .where(where)
    .orderBy(desc(commentReports.createdAt));

  const byComment = new Map<string, ReportedComment & { eventId: string; eventName: string; eventSlug: string }>();
  for (const row of rows) {
    const existing = byComment.get(row.commentId);
    if (existing) {
      existing.count += 1;
      if (!existing.reasons.includes(row.reason)) existing.reasons.push(row.reason);
      if (row.note) existing.notes.push(row.note);
      if (row.reason === "child_safety") existing.safetyHold = true;
      continue;
    }
    byComment.set(row.commentId, {
      commentId: row.commentId,
      mediaId: row.mediaId,
      eventId: row.eventId,
      eventName: row.eventName,
      eventSlug: row.eventSlug,
      body: row.body,
      authorName: commentAuthorName({
        team: row.authorId === row.ownerId,
        userName: row.userName,
        guestName: row.guestName,
      }),
      hidden: row.hiddenReason,
      reasons: [row.reason],
      notes: row.note ? [row.note] : [],
      count: 1,
      safetyHold: row.reason === "child_safety",
      latest: row.createdAt,
    });
  }
  return [...byComment.values()].sort(
    (a, b) => Number(b.safetyHold) - Number(a.safetyHold) || b.latest.getTime() - a.latest.getTime(),
  );
}

/** The host's list: comments in this event with open reports. */
export async function reportedComments(eventId: string) {
  return groupOpenReports(and(eq(commentReports.eventId, eventId), isNull(commentReports.resolvedAt)));
}

/** Klik's list, across every event, child-safety first. */
export async function listOpenCommentReports() {
  return groupOpenReports(and(isNull(commentReports.resolvedAt)));
}

/** Open comment report counts per item, for the organizer's grid. */
export async function openCommentReportCounts(eventId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ mediaId: mediaComments.mediaId, open: count() })
    .from(commentReports)
    .innerJoin(mediaComments, eq(mediaComments.id, commentReports.commentId))
    .where(and(eq(commentReports.eventId, eventId), isNull(commentReports.resolvedAt)))
    .groupBy(mediaComments.mediaId);
  return new Map(rows.map((row) => [row.mediaId, row.open]));
}

/**
 * Klik's side, from /admin. `keep` puts back what reports or Klik took down,
 * `hide` takes it down as Klik (so the host cannot show it again), `delete`
 * removes it.
 */
export async function adminResolveComment(
  commentId: string,
  { action, byUserId, note }: { action: "keep" | "hide" | "delete"; byUserId: string; note: string },
): Promise<{ eventId: string } | null> {
  const [comment] = await db
    .select({ id: mediaComments.id, eventId: mediaComments.eventId })
    .from(mediaComments)
    .where(eq(mediaComments.id, commentId))
    .limit(1);
  if (!comment) return null;

  if (action === "delete") {
    await db.delete(mediaComments).where(eq(mediaComments.id, commentId));
    return { eventId: comment.eventId };
  }
  if (action === "keep") {
    // Undoes what reports or Klik did, never the host's own choice: a comment
    // can be fine by Klik's rules and still not one the host wants up.
    await db
      .update(mediaComments)
      .set({ hiddenAt: null, hiddenByUserId: null, hiddenReason: null })
      .where(and(eq(mediaComments.id, commentId), inArray(mediaComments.hiddenReason, ["reports", "klik"])));
    await resolveCommentReports(commentId, byUserId, `Kept by Klik. ${note}`);
  } else {
    await db
      .update(mediaComments)
      .set({ hiddenAt: sql`now()`, hiddenByUserId: byUserId, hiddenReason: "klik" })
      .where(eq(mediaComments.id, commentId));
    await resolveCommentReports(commentId, byUserId, `Hidden by Klik. ${note}`);
  }
  return { eventId: comment.eventId };
}
