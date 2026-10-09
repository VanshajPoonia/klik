import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { events, type Event } from "./schema";
import { requireEventCapability, type EventActor } from "./roles";
import { eventLicenseState, eventPlan } from "./license";
import { canUsePrintStudio } from "./plans";

export const PRINT_STUDIO_PLAN_MESSAGE = "The print studio is part of Klik Premium and Klik Venue.";
export const PRINT_STUDIO_DRAFT_MESSAGE = "The print studio opens when this event goes live, with its QR code.";

/**
 * Who may use an event's print studio, for every studio route: the team
 * members who manage the QR code (owner and managers), on a plan that has the
 * studio, for an event that is live. A draft has no QR code (ACT-3), and a
 * design is a QR code on paper.
 */
export async function studioAccess(
  eventId: string,
): Promise<{ ok: true; event: Event; actor: EventActor } | { ok: false; response: NextResponse }> {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const actor = await requireEventCapability(event.id, event.ownerId, "event.qr");
  if (!actor) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canUsePrintStudio(eventPlan(event).key)) {
    return { ok: false, response: NextResponse.json({ error: PRINT_STUDIO_PLAN_MESSAGE }, { status: 403 }) };
  }
  if (eventLicenseState(event) === "draft") {
    return { ok: false, response: NextResponse.json({ error: PRINT_STUDIO_DRAFT_MESSAGE }, { status: 409 }) };
  }
  return { ok: true, event, actor };
}
