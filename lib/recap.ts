import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { isEmailConfigured } from "./email";

/**
 * GRW-1: the morning-after recap. One email per guest who asked, with the
 * event's highlights (AI-8) and a link back, at nine in the morning where the
 * guest was, the day after the event.
 *
 * The rules that make it welcome rather than marketing:
 *
 * - **Asked for, separately.** An optional address and its own tick at the
 *   entry sheet, apart from the upload consent, never needed to join.
 * - **Once.** Sending clears the address. There is no second email to send,
 *   and no list to leak.
 * - **Stoppable for good.** The unsubscribe link puts a hash of the address on
 *   `email_suppressions`, which every send checks.
 * - **Lawful.** CAN-SPAM wants a postal address in the footer of any email
 *   that invites a purchase, and this one does ("host your own"). Without
 *   `COMPANY_POSTAL_ADDRESS` guests are not offered the recap at all.
 */

/** Which words a guest agreed to, recorded with the locale as "<id>:<locale>". */
export const RECAP_CONSENT_ID = "recap-2026-10-10";
/** Local time the recap goes out. */
export const RECAP_HOUR = 9;
/** Photos in the email. The dashboard's highlights hold more; this is the top of the same rule. */
export const RECAP_PHOTOS = 12;

/** Whether a recap can be offered: email works and the footer has its address. */
export function isRecapAvailable(): boolean {
  return isEmailConfigured() && Boolean(env.COMPANY_POSTAL_ADDRESS);
}

/** A time zone the runtime knows, or null. Guests' phones send their own. */
export function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The calendar day of `instant` in `zone`, as YYYY-MM-DD. */
export function localDay(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** How far `zone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
}

/** The instant it is `hour`:00 on `day` in `zone`. Twice round, for the days the clocks change. */
export function zonedTime(day: string, hour: number, zone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  const first = wall - zoneOffset(wall, zone);
  return new Date(wall - zoneOffset(first, zone));
}

/**
 * When one guest's recap is due: nine in the morning, in the guest's zone, on
 * the day after the event. The event's date is a calendar day (stored as UTC
 * midnight); without one, or for someone who joins after it, the day after
 * they joined. A guest whose phone sent no zone gets UTC.
 */
export function recapDueAt({
  eventDate,
  joinedAt,
  timeZone,
}: {
  eventDate: Date | null;
  joinedAt: Date;
  timeZone: string | null;
}): Date {
  const zone = validTimeZone(timeZone) ?? "UTC";
  const joined = localDay(joinedAt, zone);
  const eventDay = eventDate ? eventDate.toISOString().slice(0, 10) : null;
  const day = eventDay && eventDay > joined ? eventDay : joined;
  return zonedTime(addDays(day, 1), RECAP_HOUR, zone);
}

/** A lightly checked address: something@something.something, nothing exotic. */
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

/** What `email_suppressions` stores: a SHA-256 of the address, never the address. */
export function emailHash(email: string): string {
  return createHash("sha256").update(`klik-suppression:${email.trim().toLowerCase()}`).digest("hex");
}

function sign(purpose: string, value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`${purpose}:${value}`).digest("base64url").slice(0, 32);
}

function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The unsubscribe link's signature, so nobody can unsubscribe somebody else. */
export function unsubscribeSignature(hash: string): string {
  return sign("unsubscribe", hash);
}

export function verifyUnsubscribe(hash: string, signature: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash) && matches(unsubscribeSignature(hash), signature);
}

/**
 * A photo in the email. Bound to the guest it was sent to and checked against
 * the photo's current visibility on every load, so a photo the host hides
 * after the email went stops showing in it, and the link never expires.
 */
export function recapImageSignature(guestId: string, mediaId: string): string {
  return sign("recap-image", `${guestId}:${mediaId}`);
}

export function verifyRecapImage(guestId: string, mediaId: string, signature: string): boolean {
  return matches(recapImageSignature(guestId, mediaId), signature);
}

export function recapImageUrl(appUrl: string, guestId: string, mediaId: string): string {
  return `${appUrl}/api/recap/${encodeURIComponent(guestId)}/${encodeURIComponent(mediaId)}/${recapImageSignature(guestId, mediaId)}`;
}

export function unsubscribeUrls(appUrl: string, email: string, locale: "en" | "es" = "en") {
  const hash = emailHash(email);
  const query = `e=${hash}&s=${unsubscribeSignature(hash)}${locale === "en" ? "" : `&l=${locale}`}`;
  return {
    /** The page a person lands on from the footer. */
    page: `${appUrl}/unsubscribe?${query}`,
    /** RFC 8058 one-click, which mail apps POST to from their own button. */
    oneClick: `${appUrl}/api/unsubscribe?${query}`,
  };
}
