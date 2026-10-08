import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { guestCookieName, verifyGuestSession } from "@/lib/guest";
import { eraseGuest, LegalHoldError } from "@/lib/erasure";

/**
 * A guest erasing their own contribution: every photo and video they uploaded,
 * plus the guest row holding their display name and consent timestamp.
 *
 * Deliberately needs no account. The people this protects are the ones who
 * scanned a QR code at a party, and requiring them to sign up in order to be
 * forgotten would defeat the point. The signed per-event cookie they already
 * hold is the proof, and it only ever proves who *they* are, so this cannot
 * reach anyone else's uploads.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cookieStore = await cookies();
  const token = cookieStore.get(guestCookieName(event.id))?.value;
  const guestSession = token ? await verifyGuestSession(token) : null;
  if (!guestSession || guestSession.eventId !== event.id) {
    return NextResponse.json({ error: "No guest session for this gallery" }, { status: 401 });
  }

  let result;
  try {
    result = await eraseGuest(guestSession.guestId, event.id, null, "guest_self_erasure");
  } catch (error) {
    // TRS-1: something in scope is under a legal hold, which an erasure
    // request does not override. Klik resolves these by hand.
    if (error instanceof LegalHoldError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // The cookie now points at a guest row that no longer exists, so clear it
  // rather than leaving the browser to present a dangling session.
  const response = NextResponse.json({ ok: true, ...result });
  response.cookies.delete(guestCookieName(event.id));
  return response;
}
