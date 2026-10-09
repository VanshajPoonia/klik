import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { consume, clientIp } from "@/lib/ratelimit";
import { pairKiosk } from "@/lib/kiosks";
import { guestCookieName, signGuestSession } from "@/lib/guest";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const bodySchema = z.object({ code: z.string().min(1).max(64) });

/**
 * VEN-2: turns this device into a kiosk. A POST from a button, never a GET,
 * so a link preview in a chat app cannot spend the code before the tablet
 * opens it. The device gets a guest cookie for the kiosk's own guest row and
 * nothing of the host's: whoever is signed in here stays who they were.
 */
export async function POST(request: Request) {
  const limit = await consume(`kiosk-pair:ip:${clientIp(request)}`, 20, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again a little later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const kiosk = parsed.success ? await pairKiosk(parsed.data.code) : null;
  if (!kiosk) {
    return NextResponse.json(
      { error: "This link has been used or has expired. Make a new one from the event's QR code tab." },
      { status: 404 },
    );
  }
  const [event] = await db
    .select({ id: events.id, slug: events.slug })
    .from(events)
    .where(and(eq(events.id, kiosk.eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const response = NextResponse.json({ slug: event.slug });
  response.cookies.set(
    guestCookieName(event.id),
    await signGuestSession({ guestId: kiosk.guestId, eventId: event.id, kioskId: kiosk.id }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS,
    },
  );
  return response;
}
