import { NextResponse } from "next/server";
import { findEventBySlug } from "./slugs";
import { resolveEventViewer } from "./event-viewer";
import type { Event } from "./schema";

/**
 * MED-11: the guest a self-service request is from, or the response that says
 * why there is none. A kiosk is refused: what it uploads belongs to whoever
 * was in front of it, not to the kiosk.
 */
export type GuestResolution =
  | { ok: false; response: NextResponse }
  | { ok: true; event: Event; viewer: Awaited<ReturnType<typeof resolveEventViewer>>; guestId: string };

export async function guestFor(slug: string, signedOutError = "Join the gallery to share your uploads"): Promise<GuestResolution> {
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const viewer = await resolveEventViewer(event);
  if (!viewer.guestId) {
    return { ok: false, response: NextResponse.json({ error: signedOutError }, { status: 401 }) };
  }
  if (viewer.kioskId) return { ok: false, response: NextResponse.json({ error: "A kiosk cannot do this." }, { status: 403 }) };
  return { ok: true, event, viewer, guestId: viewer.guestId };
}
