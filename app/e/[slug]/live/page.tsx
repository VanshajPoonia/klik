import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventManagerSession } from "@/lib/roles";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { canUseSlideshow } from "@/lib/plans";
import { fetchGalleryMedia } from "@/lib/media";
import { toGalleryMedia } from "@/lib/gallery-media";
import { getAppUrl } from "@/lib/env";
import { LiveDisplay } from "@/components/live/live-display";

export const metadata: Metadata = { title: "Live display", robots: { index: false } };

/**
 * VEN-1: the gallery on a projector or a TV at the venue.
 *
 * Opened by the event's own team, never by a guest: a screen in a room is a
 * broadcast, and deciding what goes on it is the host's call. It shows what
 * guests already see (approved, in the gallery), never hidden or private
 * photos, even though the person who opened it could see those.
 */
export default async function LiveDisplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)))
    .limit(1);
  if (!event) notFound();

  const manager = await requireEventManagerSession(event.id, event.ownerId);
  const plan = eventPlan(event);
  const blocked = !manager
    ? "Open the live display from your dashboard, signed in as the host."
    : eventLicenseState(event) === "draft"
      ? "The live display starts when this event goes live."
      : !canUseSlideshow(plan.key)
        ? "The live display is part of Klik Premium and Klik Venue."
        : null;
  if (blocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 text-center">
        <p className="max-w-md text-lg text-paper">{blocked}</p>
      </main>
    );
  }

  // What a guest sees, not what the host may: a public screen is a guest's view.
  const rows = await fetchGalleryMedia(event.id, { isOwner: false, guestId: null, event, limit: 100 });
  const galleryUrl = `${getAppUrl()}/e/${event.slug}`;
  const qr = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 320, color: { dark: "#050505", light: "#f3f1e9" } });

  return (
    <LiveDisplay
      slug={event.slug}
      eventName={event.name}
      accent={event.accentColor}
      qrDataUrl={qr}
      shortUrl={galleryUrl.replace(/^https?:\/\//, "")}
      initialMedia={await toGalleryMedia(rows, event.slug)}
      syncedAt={new Date().toISOString()}
    />
  );
}
