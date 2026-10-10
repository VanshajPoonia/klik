import { and, asc, eq, inArray, isNotNull, isNull, lte, max, min } from "drizzle-orm";
import { db } from "../db";
import { emailSuppressions, events, guests, media, users } from "../schema";
import { sendEmail } from "../email";
import { recapEmail } from "../emails/recap";
import { env, getAppUrl } from "../env";
import { highlightsFor } from "../highlights";
import { seenByGuests } from "../image-analysis";
import { rollUndeveloped } from "../media-access";
import { emailHash, isRecapAvailable, RECAP_PHOTOS, recapImageUrl, unsubscribeUrls } from "../recap";
import { scheduleRecap, type JobPayload } from "../jobs";
import { log } from "../observability";
import type { JobContext, JobOutcome } from "../job-runner";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A gallery still taking photos this recently is still a party. */
const QUIET_MS = HOUR;
/** Requests sent per run; the rest go in the next, straight after. */
const BATCH = 200;
/** Resend's default limit is two requests a second. */
const SEND_GAP_MS = 550;
/** A failed send is tried again this much later, this many times, then let go. */
const RETRY_MS = 6 * HOUR;
const MAX_FAILURES = 3;
/** With nothing to show, a request waits this long past its time, then is let go. */
const GIVE_UP_EMPTY_MS = 3 * DAY;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GRW-1: sends one event's recaps that are due, one email per address however
 * many phones it joined from, and clears each address once its email has gone.
 * Then waits, by requeueing itself, for the next request that falls due.
 */
export async function sendRecaps(payload: JobPayload<"recap.send">, context: JobContext): Promise<JobOutcome> {
  const pending = and(eq(guests.eventId, payload.eventId), isNotNull(guests.recapEmail), isNull(guests.recapSentAt));
  const [event] = await db.select().from(events).where(eq(events.id, payload.eventId)).limit(1);
  if (!event || event.deletedAt || event.purgedAt || !event.recapEnabled) {
    // Gone, emptied, or the host stopped it: nothing will be sent, so nothing is kept.
    await db.update(guests).set({ recapEmail: null }).where(pending);
    log.info("recap.dropped", { eventId: payload.eventId, reason: !event ? "missing" : event.recapEnabled ? "gone" : "turned_off" });
    return;
  }
  if (event.suspendedAt) {
    // Held while Klik has the gallery paused, and sent if it reopens.
    return { requeue: { delayMs: DAY } };
  }
  if (!isRecapAvailable()) {
    // Held, not dropped: these people asked, and the fix is configuration.
    log.warn("recap.unavailable", { eventId: event.id });
    return { requeue: { delayMs: DAY } };
  }
  const now = new Date();
  if (rollUndeveloped(event, now)) {
    // A disposable roll is dark until it develops; the recap waits with it.
    return { requeue: { delayMs: event.developsAt ? Math.max(HOUR, event.developsAt.getTime() - now.getTime()) : DAY } };
  }
  const [latest] = await db.select({ at: max(media.createdAt) }).from(media).where(eq(media.eventId, event.id));
  if (latest?.at && now.getTime() - new Date(latest.at).getTime() < QUIET_MS) {
    return { requeue: { delayMs: 2 * HOUR } };
  }

  const due = await db
    .select({ id: guests.id, email: guests.recapEmail, locale: guests.recapLocale, dueAt: guests.recapDueAt, failures: guests.recapFailures })
    .from(guests)
    .where(and(pending, lte(guests.recapDueAt, now)))
    .orderBy(asc(guests.recapDueAt))
    .limit(BATCH);

  if (due.length > 0) {
    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        status: media.status,
        visibility: media.visibility,
        guestId: media.guestId,
        contentHash: media.contentHash,
        perceptualHash: media.perceptualHash,
        sharpness: media.sharpness,
        brightness: media.brightness,
        reactionCount: media.reactionCount,
        commentCount: media.commentCount,
        momentId: media.momentId,
        capturedAt: media.capturedAt,
        createdAt: media.createdAt,
        highlight: media.highlight,
      })
      .from(media)
      .where(and(eq(media.eventId, event.id), isNull(media.deletedAt)));
    const photos = seenByGuests(rows).filter((row) => row.kind === "photo");
    const kinds = new Map(rows.map((row) => [row.id, row.kind]));
    const picks = highlightsFor(rows, RECAP_PHOTOS).picks.filter((id) => kinds.get(id) === "photo");

    if (picks.length === 0) {
      // Nothing to show yet. Photos may still be on their way, but not for ever.
      const stale = due.filter((guest) => guest.dueAt && now.getTime() - guest.dueAt.getTime() > GIVE_UP_EMPTY_MS);
      if (stale.length > 0) {
        await db.update(guests).set({ recapEmail: null }).where(inArray(guests.id, stale.map((guest) => guest.id)));
        log.info("recap.nothing_to_send", { eventId: event.id, dropped: stale.length });
      }
      return stale.length === due.length ? nextDue(pending, now) : { requeue: { delayMs: DAY } };
    }

    const appUrl = getAppUrl();
    const galleryUrl = `${appUrl}/e/${event.slug}`;
    const [owner] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, event.ownerId)).limit(1);
    // GRW-5: the host's own link, so a guest who goes on to host credits them.
    const hostUrl = owner?.code ? `${appUrl}/r/${owner.code}` : appUrl;
    const contributors = new Set(photos.map((row) => row.guestId ?? "the team")).size;

    const byAddress = new Map<string, typeof due>();
    for (const guest of due) {
      const email = (guest.email as string).toLowerCase();
      byAddress.set(email, [...(byAddress.get(email) ?? []), guest]);
    }
    const hashes = new Map([...byAddress.keys()].map((email) => [email, emailHash(email)]));
    const suppressed = new Set(
      (
        await db
          .select({ hash: emailSuppressions.emailHash })
          .from(emailSuppressions)
          .where(inArray(emailSuppressions.emailHash, [...hashes.values()]))
      ).map((row) => row.hash),
    );

    for (const [email, group] of byAddress) {
      // Leave time to record the last send before the runner's deadline.
      if (Date.now() > context.deadline - 15_000) return { requeue: { delayMs: 0 } };
      const ids = group.map((guest) => guest.id);
      if (suppressed.has(hashes.get(email) as string)) {
        await db.update(guests).set({ recapEmail: null }).where(inArray(guests.id, ids));
        continue;
      }

      const first = group[0];
      const locale = first.locale === "es" ? "es" : "en";
      const unsubscribe = unsubscribeUrls(appUrl, email, locale);
      const message = recapEmail({
        locale,
        eventName: event.name,
        eventDate: event.eventDate,
        photos: picks.map((id) => ({ src: recapImageUrl(appUrl, first.id, id), href: `${galleryUrl}?m=${encodeURIComponent(id)}` })),
        photoCount: photos.length,
        contributorCount: contributors,
        galleryUrl,
        hostUrl,
        unsubscribeUrl: unsubscribe.page,
        privacyUrl: `${appUrl}/privacy`,
        postalAddress: env.COMPANY_POSTAL_ADDRESS as string,
      });
      const result = await sendEmail({
        to: email,
        ...message,
        headers: { "List-Unsubscribe": `<${unsubscribe.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });

      if (result.sent) {
        await db.update(guests).set({ recapEmail: null, recapSentAt: new Date() }).where(inArray(guests.id, ids));
      } else if (result.reason === "not_configured") {
        return { requeue: { delayMs: DAY } };
      } else if (Math.max(...group.map((guest) => guest.failures)) + 1 >= MAX_FAILURES) {
        await db.update(guests).set({ recapEmail: null }).where(inArray(guests.id, ids));
        log.warn("recap.given_up", { eventId: event.id, guests: ids.length });
      } else {
        for (const guest of group) {
          await db
            .update(guests)
            .set({ recapFailures: guest.failures + 1, recapDueAt: new Date(Date.now() + RETRY_MS) })
            .where(eq(guests.id, guest.id));
        }
      }
      await sleep(SEND_GAP_MS);
    }
  }

  return nextDue(pending, new Date());
}

/** Runs again when the next request falls due, or finishes if none is left. */
async function nextDue(pending: ReturnType<typeof and>, now: Date): Promise<JobOutcome> {
  const [next] = await db.select({ at: min(guests.recapDueAt) }).from(guests).where(pending);
  if (!next?.at) return;
  return { requeue: { delayMs: Math.max(0, new Date(next.at).getTime() - now.getTime()) } };
}

/** The daily safety net: any event with a recap past due gets its job back. */
export async function backfillRecaps(payload: JobPayload<"recap.backfill">, context: JobContext): Promise<JobOutcome> {
  void payload;
  void context;
  const now = new Date();
  const waiting = await db
    .selectDistinct({ eventId: guests.eventId })
    .from(guests)
    .where(and(isNotNull(guests.recapEmail), isNull(guests.recapSentAt), lte(guests.recapDueAt, now)))
    .limit(500);
  for (const { eventId } of waiting) await scheduleRecap(eventId, now);
  log.info("recap.backfill_scheduled", { events: waiting.length });
}
