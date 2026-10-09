import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findEventBySlug } from "@/lib/slugs";
import { guestCookieName, verifyGuestSession } from "@/lib/guest";
import { requireEventManagerSession } from "@/lib/roles";

/**
 * VEN-2: takes this device out of kiosk mode. Only for the event's team, so a
 * guest at the kiosk cannot leave it for the gallery. The kiosk stays on, so
 * the host can pair another tablet, or this one again, from the dashboard.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await requireEventManagerSession(event.id, event.ownerId))) {
    return NextResponse.json({ error: "Only the event's team can do this." }, { status: 403 });
  }
  const token = (await cookies()).get(guestCookieName(event.id))?.value;
  const session = token ? await verifyGuestSession(token) : null;
  const response = NextResponse.json({ ok: true });
  if (session?.kioskId) response.cookies.delete(guestCookieName(event.id));
  return response;
}
