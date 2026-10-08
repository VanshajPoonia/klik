import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { forgetGallery } from "@/lib/guest-accounts";
import { LegalHoldError } from "@/lib/erasure";
import { guestCookieName } from "@/lib/guest";

/**
 * ACC-4: erases everything this account shared at one event as a guest, from
 * the account rather than from that gallery's cookie. Permanent: the host
 * cannot restore it either, same as the button in the gallery.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let result;
  try {
    result = await forgetGallery(session.user.id, eventId);
  } catch (error) {
    if (error instanceof LegalHoldError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  if (result.guests === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const response = NextResponse.json({ ok: true, ...result });
  // The cookie names a guest row that no longer exists.
  response.cookies.delete(guestCookieName(eventId));
  return response;
}
