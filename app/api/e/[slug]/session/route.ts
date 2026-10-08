import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { events, guests } from "@/lib/schema";
import { isExpired } from "@/lib/access";
import { CURRENT_CONSENT } from "@/lib/consent";
import { eventLicenseState } from "@/lib/license";
import { clientIp, consume } from "@/lib/ratelimit";
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
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A draft has no guests yet: it has not gone live, and its QR code does not
  // exist. Same answer the gallery page gives, so the two cannot disagree.
  if (eventLicenseState(event) === "draft") {
    return NextResponse.json({ error: "This gallery is not open yet" }, { status: 403 });
  }
  if (isExpired(event)) {
    return NextResponse.json({ error: "This event has ended" }, { status: 410 });
  }
  if (event.visibility === "private") {
    return NextResponse.json({ error: "This gallery is private" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Consent is required" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });

  if (event.visibility === "password") {
    if (!parsed.data.password || !event.passwordHash) {
      return NextResponse.json({ error: "Password required" }, { status: 401 });
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
        { error: "Too many attempts. Try again a little later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    const valid = await bcrypt.compare(parsed.data.password, event.passwordHash);
    if (!valid) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });

    const unlockToken = await signEventUnlock(event.id, event.accessVersion);
    response.cookies.set(eventUnlockCookieName(event.id), unlockToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS,
    });
  }

  const [guest] = await db
    .insert(guests)
    .values({
      id: nanoid(),
      eventId: event.id,
      displayName: parsed.data.name || null,
      consentedAt: new Date(),
      consentVersion: CURRENT_CONSENT.id,
    })
    .returning();

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
