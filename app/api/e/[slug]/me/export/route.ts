import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findEventBySlug } from "@/lib/slugs";
import { guestCookieName, verifyGuestSession } from "@/lib/guest";
import { cookieFrom } from "@/lib/request-cookies";
import { consume } from "@/lib/ratelimit";
import { getAppUrl } from "@/lib/env";
import { accountGuestAt, guestExport } from "@/lib/data-export";
import { streamZip } from "@/lib/zip-stream";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * TRS-2: a guest downloads everything they shared at one gallery, with a
 * `data.json` saying what Klik holds about them there. Needs no account, as
 * erasing does not: the signed cookie for this event proves who they are and
 * reaches nobody else. A signed-in account may download what its guest row
 * shared from /me, on any phone. Available whatever the gallery's own access
 * window says, because it is the guest's data, not the gallery.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = cookieFrom(request.headers.get("cookie"), guestCookieName(event.id));
  const guestSession = token ? await verifyGuestSession(token) : null;
  let guestId: string | null = null;
  if (guestSession?.eventId === event.id) {
    // VEN-2: a kiosk's "own" uploads are everyone who stood in front of it.
    if (guestSession.kioskId) return NextResponse.json({ error: "A kiosk cannot do this." }, { status: 403 });
    guestId = guestSession.guestId;
  } else {
    const session = await auth();
    if (session?.user?.id) guestId = await accountGuestAt(session.user.id, event.id);
  }
  if (!guestId) return NextResponse.json({ error: "No guest session for this gallery" }, { status: 401 });

  const limit = await consume(`export:guest:${guestId}`, 5, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You downloaded this a few times already. Try again in an hour." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const exported = await guestExport(guestId, getAppUrl());
  if (!exported) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return streamZip(exported.items, `klik-${event.slug}-what-i-shared.zip`, {}, [
    { name: "data.json", content: JSON.stringify(exported.data, null, 2) },
  ]);
}
