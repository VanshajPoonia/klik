import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, type Event } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { canCustomizeGallery, canUsePrintStudio } from "@/lib/plans";
import { getAppUrl } from "@/lib/env";
import { VOLT, eventDateLabel } from "@/lib/print/templates";

/**
 * The studio pages' own check, the same as `studioAccess` for the routes:
 * the owner or a manager, on a plan with the studio, for a live event. The
 * pages show why instead of answering with a status.
 */
export async function loadStudioEvent(id: string): Promise<
  | { state: "ready"; event: Event; galleryUrl: string; dateLabel: string | null; accent: string; backHref: string }
  | { state: "plan"; event: Event; backHref: string }
  | { state: "draft"; event: Event; backHref: string }
> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) notFound();
  const actor = await requireEventCapability(event.id, event.ownerId, "event.qr");
  if (!actor) notFound();
  const backHref = `/dashboard/events/${event.id}`;
  const plan = eventPlan(event);
  if (!canUsePrintStudio(plan.key)) return { state: "plan", event, backHref };
  if (eventLicenseState(event) === "draft") return { state: "draft", event, backHref };
  return {
    state: "ready",
    event,
    galleryUrl: `${getAppUrl()}/e/${event.slug}`,
    dateLabel: eventDateLabel(event.eventDate),
    accent: canCustomizeGallery(plan.key) ? event.accentColor : VOLT,
    backHref,
  };
}
