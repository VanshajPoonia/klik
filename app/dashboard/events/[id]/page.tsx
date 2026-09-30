import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { albums, eventCoHosts, events, media, users, venueClients } from "@/lib/schema";
import { toOrganizerEvent } from "@/lib/events";
import { getAppUrl } from "@/lib/env";
import { getAccountPlan } from "@/lib/account-plans";
import {
  canCustomizeGallery,
  canCustomizeQr,
  canDownloadQrSign,
  canManageEventClients,
  canUseAlbums,
  canUseCoHosts,
  canUseSlideshow,
  canUseVenueHub,
} from "@/lib/plans";
import { withProtectedMediaUrl } from "@/lib/media-delivery";
import { EventDashboard } from "@/components/dashboard/event-dashboard";
import { requireEventManagerSession } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Manage event",
  robots: { index: false },
};

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) notFound();
  const managerSession = await requireEventManagerSession(event.id, event.ownerId);
  if (!managerSession) notFound();

  const [mediaRows, plan, albumRows, coHostRows, clientRows] = await Promise.all([
    db
      .select()
      .from(media)
      .where(eq(media.eventId, id))
      .orderBy(media.createdAt)
      .then((rows) => rows.map((item) => withProtectedMediaUrl(item, event.slug))),
    getAccountPlan(event.ownerId),
    db.select().from(albums).where(eq(albums.eventId, id)).orderBy(albums.createdAt),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        username: users.username,
      })
      .from(eventCoHosts)
      .innerJoin(users, eq(users.id, eventCoHosts.userId))
      .where(eq(eventCoHosts.eventId, id))
      .orderBy(eventCoHosts.createdAt),
    db
      .select()
      .from(venueClients)
      .where(eq(venueClients.ownerId, event.ownerId))
      .orderBy(venueClients.name),
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
      canManageAlbums={canUseAlbums(plan.key)}
      canManageCoHosts={canUseCoHosts(plan.key) && session.user.id === event.ownerId}
      canCustomizeGallery={canCustomizeGallery(plan.key)}
      canCustomizeQr={canCustomizeQr(plan.key)}
      canDownloadQrSign={canDownloadQrSign(plan.key)}
      canUseVenueHub={canUseVenueHub(plan.key)}
      canDeleteEvent={
        session.user.id === event.ownerId || session.user.role === "superadmin"
      }
      albums={albumRows}
      coHosts={coHostRows}
      clients={clientRows}
    />
  );
}
