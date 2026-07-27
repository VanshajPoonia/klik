import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { events, guests } from "@/lib/schema";
import { isExpired } from "@/lib/access";
import { getAccountPlan } from "@/lib/account-plans";
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
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);
  if (isExpired(event, plan.galleryAccessDays)) {
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
    const valid = await bcrypt.compare(parsed.data.password, event.passwordHash);
    if (!valid) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });

    const unlockToken = await signEventUnlock(event.id);
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
