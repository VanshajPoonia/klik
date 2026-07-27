import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { toOrganizerEvent } from "@/lib/events";
import { getAppUrl } from "@/lib/env";
import { getAccountPlan } from "@/lib/account-plans";
import { canManageEventClients, canUseSlideshow } from "@/lib/plans";
import { EventDashboard } from "@/components/dashboard/event-dashboard";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) notFound();
  if (event.ownerId !== session.user.id && session.user.role !== "superadmin") notFound();

  const [mediaRows, plan] = await Promise.all([
    db.select().from(media).where(eq(media.eventId, id)).orderBy(media.createdAt),
    getAccountPlan(event.ownerId),
  ]);

  const guestUrl = `${getAppUrl()}/e/${event.slug}`;
  const backHref = session.user.role === "superadmin" ? "/admin" : "/dashboard";

  return (
    <EventDashboard
      event={toOrganizerEvent(event)}
      initialMedia={mediaRows}
      guestUrl={guestUrl}
      backHref={backHref}
      canManageClients={canManageEventClients(plan.key)}
      canSlideshow={canUseSlideshow(plan.key)}
    />
  );
}
