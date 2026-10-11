import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { events, media, mediaReports, mediaVision, users, type ReportReason } from "./schema";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { consume } from "./ratelimit";
import { getAppUrl } from "./env";
import { log, reportError } from "./observability";
import type { SafetyReason } from "./vision";

/**
 * AI-6: what happens when the vision model flags a photo.
 *
 * - **Held for the organizer.** An approved photo goes back to pending, so
 *   guests stop seeing it within about a minute of it landing; one already
 *   pending stays so. The organizer sees why on the tile and decides: approving
 *   it puts it back, and screening never looks at it again.
 * - **In Klik's queue too** (ADM-5), as a report from `SCREENING_REPORTER`,
 *   when the model said what it saw. It is Klik's to close, like a legal hold:
 *   an organizer's approval decides what their guests see, not whether Klik
 *   looks, because the organizer of a gallery that exists to share such photos
 *   would approve them all.
 * - **Never a child-safety report.** The model is not asked about ages (see
 *   lib/vision.ts), and a hold under 18 U.S.C. 2258A is a person's decision
 *   made from a guest's report, not a classifier's.
 *
 * Screening runs after a photo lands rather than before it shows. Holding
 * every upload until a model answered would make each guest wait on a third
 * party, and an outage there would stop every gallery; the minute's window is
 * the price, and the live display's own 60-second delay covers the screen in
 * the room. Decided 2026-10-11, ROADMAP.md section C.
 */

/** The reporter key Klik's screening files under, one per photo. */
export const SCREENING_REPORTER = "klik:screening";

const REASON_FOR_REPORT: Record<SafetyReason, ReportReason> = {
  sexual: "nudity",
  violence: "violence",
  hate: "harassment",
};

/** What the organizer reads, never more specific than this. */
export const SCREENING_REASON_LABELS: Record<SafetyReason | "unclear", string> = {
  sexual: "nudity or sexual content",
  violence: "graphic violence",
  hate: "a hate symbol",
  unclear: "our screening could not describe it",
};

export function screeningSummary(safety: "flagged" | "unclear", reasons: readonly string[]): string {
  if (safety === "unclear") return SCREENING_REASON_LABELS.unclear;
  const labels = reasons
    .filter((reason): reason is SafetyReason => reason in REASON_FOR_REPORT)
    .map((reason) => SCREENING_REASON_LABELS[reason]);
  return labels.length > 0 ? `it may show ${labels.join(" or ")}` : "it may not be suitable for the gallery";
}

export async function holdForReview({
  mediaId,
  eventId,
  safety,
  reasons,
}: {
  mediaId: string;
  eventId: string;
  safety: "flagged" | "unclear";
  reasons: SafetyReason[];
}): Promise<{ hidden: boolean }> {
  const hiddenRows = await db
    .update(media)
    .set({ status: "pending" })
    .where(and(eq(media.id, mediaId), eq(media.status, "approved"), isNull(media.deletedAt)))
    .returning({ id: media.id });
  const hidden = hiddenRows.length > 0;

  if (safety === "flagged" && reasons.length > 0) {
    await db
      .insert(mediaReports)
      .values({
        id: `rep_${nanoid()}`,
        eventId,
        mediaId,
        reporterKey: SCREENING_REPORTER,
        reason: REASON_FOR_REPORT[reasons[0]],
        note: `Klik's automatic screening: ${screeningSummary(safety, reasons)}.`,
      })
      .onConflictDoNothing();
  }

  log.info("screening.held", { eventId, mediaId, safety, reasons, hidden });
  await tellOrganizer({ eventId, safety, reasons }).catch((error) => reportError("screening.notify_failed", error, { eventId }));
  return { hidden };
}

/** At most one email per event every six hours, so a burst is one message. */
async function tellOrganizer({
  eventId,
  safety,
  reasons,
}: {
  eventId: string;
  safety: "flagged" | "unclear";
  reasons: SafetyReason[];
}) {
  const [row] = await db
    .select({ eventName: events.name, ownerEmail: users.email, ownerName: users.name })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row?.ownerEmail) return;
  const throttle = await consume(`screening-email:${eventId}`, 1, 6 * 60 * 60);
  if (!throttle.allowed) return;
  const appUrl = getAppUrl();
  await sendEmail({
    to: row.ownerEmail,
    ...noticeEmail({
      subject: `A photo in ${row.eventName} is waiting for you`,
      heading: "A photo is waiting for you",
      paragraphs: [
        `Klik's automatic screening held back a photo in ${row.eventName} because ${screeningSummary(safety, reasons)}. Guests cannot see it until you look.`,
        "If it is fine, approve it and it goes back into the gallery. Screening can be wrong, and approving it is your call.",
      ],
      cta: { label: "Review it", url: `${appUrl}/dashboard/events/${eventId}` },
      footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} about a gallery on your account.`,
    }),
  });
}

/** For the organizer's grid: the photos screening held, and why. */
export async function screeningFlags(eventId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ mediaId: mediaVision.mediaId, safety: mediaVision.safety, reasons: mediaVision.safetyReasons })
    .from(mediaVision)
    .where(and(eq(mediaVision.eventId, eventId), inArray(mediaVision.safety, ["flagged", "unclear"])));
  return new Map(
    rows.map((row) => [row.mediaId, screeningSummary(row.safety as "flagged" | "unclear", row.reasons)]),
  );
}
