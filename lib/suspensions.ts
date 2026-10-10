import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db";
import { events, mediaReports, users } from "./schema";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import type { ReportReason } from "./schema";
import { reportError } from "./observability";

/**
 * ADM-5: Klik's hand on a gallery.
 *
 * **Pausing** (`events.suspended_at`) closes every way in that is not the
 * event's own team: the gallery page and every route behind it (through
 * `canViewGallery`), joining, uploads (through `canUpload`), share links, the
 * live display, the venue hub, public profiles and the recap email. The team
 * keeps the dashboard and everything in it, and nothing is deleted, so a
 * pause is fully undone by lifting it.
 *
 * **The reason is the organizer's to read**, and is emailed to them. It is a
 * separate field from the note a superadmin writes for the record, because
 * that note can hold what must never reach a suspect: a CyberTipline report
 * number, or what was found.
 */

async function ownerOf(eventId: string) {
  const [row] = await db
    .select({ id: events.id, name: events.name, email: users.email, ownerName: users.name })
    .from(events)
    .innerJoin(users, eq(users.id, events.ownerId))
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}

/** What a report was for, as the organizer is told it. Child safety is never sent. */
const ORGANIZER_REASONS: Record<ReportReason, string> = {
  child_safety: "a safety concern",
  nudity: "nudity or sexual content",
  violence: "violence or something disturbing",
  harassment: "bullying, harassment or hate",
  privacy: "someone in it who does not want it shared",
  copyright: "someone else's work, shared without permission",
  spam: "spam, or nothing to do with the event",
  other: "something else",
};

const greeting = (name: string | null) => (name?.trim() ? `Hi ${name.trim()},` : "Hi,");

/** Pauses a gallery. False when it is gone or already paused. Emails the owner. */
export async function suspendEvent(eventId: string, { byUserId, reason }: { byUserId: string; reason: string }) {
  const [row] = await db
    .update(events)
    .set({ suspendedAt: new Date(), suspendedReason: reason, suspendedByUserId: byUserId, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), isNull(events.deletedAt), isNull(events.suspendedAt)))
    .returning({ id: events.id });
  if (!row) return false;

  const owner = await ownerOf(eventId);
  if (owner?.email) {
    const appUrl = getAppUrl();
    await sendEmail({
      to: owner.email,
      ...noticeEmail({
        subject: `${owner.name} is paused`,
        heading: `We have paused ${owner.name}`,
        paragraphs: [
          greeting(owner.ownerName),
          reason,
          "While it is paused, guests cannot open the gallery or add to it, and its share links do not open. Nothing in it has been deleted, and you can still see everything from your dashboard.",
          "If you think this is a mistake, call or text us and a person will look at it with you.",
        ],
        cta: { label: "Open your dashboard", url: `${appUrl}/dashboard/events/${eventId}` },
        footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} about a gallery on your account.`,
      }),
    }).catch((error) => reportError("suspension.email_failed", error));
  }
  return true;
}

/** Reopens a paused gallery, exactly as it was. Emails the owner. */
export async function liftSuspension(eventId: string) {
  const [row] = await db
    .update(events)
    .set({ suspendedAt: null, suspendedReason: null, suspendedByUserId: null, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), isNotNull(events.suspendedAt)))
    .returning({ id: events.id });
  if (!row) return false;

  const owner = await ownerOf(eventId);
  if (owner?.email) {
    const appUrl = getAppUrl();
    await sendEmail({
      to: owner.email,
      ...noticeEmail({
        subject: `${owner.name} is open again`,
        heading: `${owner.name} is open again`,
        paragraphs: [
          greeting(owner.ownerName),
          "We have finished our review and reopened your gallery. Guests can open it, add to it and use its share links again, just as before.",
        ],
        cta: { label: "Open your dashboard", url: `${appUrl}/dashboard/events/${eventId}` },
        footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} about a gallery on your account.`,
      }),
    }).catch((error) => reportError("suspension.email_failed", error));
  }
  return true;
}

/**
 * Asks the organizer to look at a reported photo themselves: they can keep it
 * or delete it from the gallery tab, where reported photos are marked. Says
 * what it was reported as, never by whom or with what note.
 */
export async function notifyOrganizerOfReport(mediaId: string, eventId: string, reasons: ReportReason[]) {
  const owner = await ownerOf(eventId);
  if (!owner?.email) return { sent: false as const };
  const appUrl = getAppUrl();
  const labels = reasons.map((reason) => ORGANIZER_REASONS[reason]);
  const result = await sendEmail({
    to: owner.email,
    ...noticeEmail({
      subject: `A guest reported a photo in ${owner.name}`,
      heading: "Please look at a reported photo",
      paragraphs: [
        greeting(owner.ownerName),
        `Someone at ${owner.name} reported a photo for ${labels.join(", and for ")}. You know your guests better than we do, so we would like you to look at it.`,
        "It is marked in your gallery tab. Keep it if it is fine, or delete it if it should not be there. If it is serious, call or text us.",
      ],
      cta: { label: "Review it", url: `${appUrl}/dashboard/events/${eventId}` },
      footer: `Sent by ${appUrl.replace(/^https?:\/\//, "")} about a gallery on your account.`,
    }),
  });
  if (result.sent) {
    await db
      .update(mediaReports)
      .set({ organizerNotifiedAt: new Date() })
      .where(and(eq(mediaReports.mediaId, mediaId), isNull(mediaReports.resolvedAt)));
  }
  return result;
}
