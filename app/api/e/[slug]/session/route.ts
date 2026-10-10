import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { guests } from "@/lib/schema";
import { isExpired } from "@/lib/access";
import { auth } from "@/lib/auth";
import { existingGuestFor } from "@/lib/guest-accounts";
import { consentRecordId } from "@/lib/consent";
import { LOCALES } from "@/lib/i18n/locale";
import { eventLicenseState } from "@/lib/license";
import { clientIp, consume } from "@/lib/ratelimit";
import { isRecapAvailable, normalizeEmail, RECAP_CONSENT_ID, recapDueAt } from "@/lib/recap";
import { scheduleRecap } from "@/lib/jobs";
import { reportError } from "@/lib/observability";
import {
  signGuestSession,
  guestCookieName,
  signEventUnlock,
  eventUnlockCookieName,
} from "@/lib/guest";

const bodySchema = z.object({
  name: z.string().trim().max(80).optional(),
  consent: z.literal(true),
  password: z.string().max(200).optional(),
  // TRS-3: the language the consent was shown in, recorded with it.
  locale: z.enum(LOCALES).optional(),
  // GRW-1: the morning-after recap. Optional, and only with its own tick.
  recapEmail: z.string().max(320).optional(),
  recapConsent: z.literal(true).optional(),
  // The phone's zone, so "nine in the morning" is the guest's morning.
  timeZone: z.string().max(64).optional(),
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A draft has no guests yet: it has not gone live, and its QR code does not
  // exist. Same answer the gallery page gives, so the two cannot disagree.
  if (eventLicenseState(event) === "draft") {
    return NextResponse.json({ error: "This gallery is not open yet", code: "not_open" }, { status: 403 });
  }
  // ADM-5: paused by Klik.
  if (event.suspendedAt) {
    return NextResponse.json({ error: "This gallery is unavailable for now", code: "suspended" }, { status: 403 });
  }
  if (isExpired(event)) {
    return NextResponse.json({ error: "This event has ended", code: "ended" }, { status: 410 });
  }
  if (event.visibility === "private") {
    return NextResponse.json({ error: "This gallery is private", code: "private" }, { status: 403 });
  }

  // F-2: each join writes a guest row. Generous, because a whole wedding joins
  // through the venue's one address within the hour; the roadmap's first
  // figure of 10 would have shut the door on the eleventh guest.
  const [joinsByIp, joinsByEvent] = await Promise.all([
    consume(`session:ip:${clientIp(request)}`, 300, 60 * 60),
    consume(`session:event:${event.id}`, 3000, 60 * 60),
  ]);
  if (!joinsByIp.allowed || !joinsByEvent.allowed) {
    const retryAfter = Math.max(joinsByIp.allowed ? 0 : joinsByIp.retryAfter, joinsByEvent.allowed ? 0 : joinsByEvent.retryAfter);
    return NextResponse.json(
      { error: "Too many attempts. Try again a little later.", code: "too_many_tries" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Consent is required", code: "consent_required" }, { status: 400 });
  }

  // GRW-1. Only when the host offers it and it can actually be sent; an
  // address without its own tick is not kept.
  let recap: Partial<typeof guests.$inferInsert> = {};
  const offersRecap = event.recapEnabled && isRecapAvailable();
  if (offersRecap && parsed.data.recapConsent && parsed.data.recapEmail?.trim()) {
    const email = normalizeEmail(parsed.data.recapEmail);
    if (!email) {
      return NextResponse.json({ error: "That email address does not look right", code: "recap_email_invalid" }, { status: 400 });
    }
    const now = new Date();
    recap = {
      recapEmail: email,
      recapConsent: `${RECAP_CONSENT_ID}:${parsed.data.locale ?? "en"}`,
      recapConsentedAt: now,
      recapLocale: parsed.data.locale ?? "en",
      recapDueAt: recapDueAt({ eventDate: event.eventDate, joinedAt: now, timeZone: parsed.data.timeZone ?? null }),
      recapFailures: 0,
      recapSentAt: null,
    };
  }

  const response = NextResponse.json({ ok: true });

  if (event.visibility === "password") {
    if (!parsed.data.password || !event.passwordHash) {
      return NextResponse.json({ error: "Password required", code: "password_required" }, { status: 401 });
    }
    // F-2: a gallery password is short, shared at a party, and was guessable
    // as fast as anyone cared to try. Per IP and per event, so a whole venue
    // behind one NAT address is not locked out by one person's typos, and a
    // script cannot spread its guesses across many galleries from one address.
    const [ipLimit, eventLimit] = await Promise.all([
      consume(`gallery-pw:ip:${clientIp(request)}`, 10, 60 * 60),
      consume(`gallery-pw:event:${event.id}`, 100, 60 * 60),
    ]);
    if (!ipLimit.allowed || !eventLimit.allowed) {
      const retryAfter = Math.max(
        ipLimit.allowed ? 0 : ipLimit.retryAfter,
        eventLimit.allowed ? 0 : eventLimit.retryAfter,
      );
      return NextResponse.json(
        { error: "Too many attempts. Try again a little later.", code: "too_many_tries" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    const valid = await bcrypt.compare(parsed.data.password, event.passwordHash);
    if (!valid) return NextResponse.json({ error: "Incorrect password", code: "wrong_password" }, { status: 401 });

    const unlockToken = await signEventUnlock(event.id, event.accessVersion);
    response.cookies.set(eventUnlockCookieName(event.id), unlockToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS,
    });
  }

  // ACC-5: someone signed in who has joined this gallery before, on any phone,
  // carries on as that guest, so what they uploaded stays theirs. Consent is
  // taken again regardless, because this request just gave it and the text
  // may have changed since.
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const returning = userId ? await existingGuestFor(userId, event.id) : null;
  const [guest] = returning
    ? await db
        .update(guests)
        .set({
          consentedAt: new Date(),
          consentVersion: consentRecordId(parsed.data.locale ?? "en"),
          ...(parsed.data.name ? { displayName: parsed.data.name } : {}),
          ...recap,
        })
        .where(eq(guests.id, returning.id))
        .returning()
    : await db
        .insert(guests)
        .values({
          id: nanoid(),
          eventId: event.id,
          displayName: parsed.data.name || null,
          consentedAt: new Date(),
          consentVersion: consentRecordId(parsed.data.locale ?? "en"),
          userId,
          ...recap,
        })
        .returning();

  if (recap.recapDueAt) {
    // A lost schedule is caught by the daily recap.backfill, so joining never fails on it.
    await scheduleRecap(event.id, recap.recapDueAt).catch((error) => reportError("recap.schedule_failed", error));
  }

  const guestToken = await signGuestSession({ guestId: guest.id, eventId: event.id });
  response.cookies.set(guestCookieName(event.id), guestToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS,
  });

  return response;
}
