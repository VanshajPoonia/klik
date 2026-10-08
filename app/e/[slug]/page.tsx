import { cache } from "react";
import { after } from "next/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { albums, events, guests, media } from "@/lib/schema";
import { canUpload, canViewGallery } from "@/lib/access";
import { eventPlan } from "@/lib/license";
import { eventUsage } from "@/lib/usage";
import { countGalleryOpen } from "@/lib/insights";
import { rollUndeveloped } from "@/lib/media-access";
import {
  guestCookieName,
  verifyGuestSession,
  eventUnlockCookieName,
  verifyEventUnlock,
} from "@/lib/guest";
import { toPublicEvent } from "@/lib/events";
import { fetchGalleryMedia } from "@/lib/media";
import { toGalleryMedia } from "@/lib/gallery-media";
import { signMediaUrls } from "@/lib/media-urls";
import {
  canCustomizeGallery,
  canUseAlbums,
  canUseSlideshow,
  removesKlikBranding,
} from "@/lib/plans";
import { requireEventManagerSession } from "@/lib/roles";
import { EntrySheet } from "@/components/guest/entry-sheet";
import { GuestGallery } from "@/components/guest/guest-gallery";

// Shared by the page and its metadata so one request runs one query.
const getEventBySlug = cache(async (slug: string) => {
  const event = (await findEventBySlug(slug))?.event;
  return event ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  // QR-1: a former address serves the gallery directly rather than
  // redirecting, because a different URL appearing in a guest's address bar
  // looks like a phishing hop on a phone. The canonical link says which address
  // is current, for anything that cares.
  return {
    title: event?.name,
    robots: { index: false },
    alternates: event && event.slug !== slug ? { canonical: `/e/${event.slug}` } : undefined,
  };
}

export default async function GuestEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const plan = eventPlan(event);

  const managerSession = await requireEventManagerSession(event.id, event.ownerId);
  const isOwner = Boolean(managerSession);

  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie
    ? await verifyEventUnlock(unlockCookie, event.id, event.accessVersion)
    : false;

  const access = canViewGallery(event, { isOwner, hasUnlockCookie });

  if (!access.allowed) {
    if (access.reason === "password_required") {
      return <EntrySheet slug={slug} eventName={event.name} requiresPassword />;
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-2xl text-paper">
          {access.reason === "expired"
            ? "This event has ended."
            : access.reason === "not_open"
              ? "This gallery is not open yet."
              : "This gallery is private."}
        </h1>
        <p className="mt-3 max-w-sm text-sm text-muted">
          {access.reason === "expired"
            ? "Uploads are closed, but the organizer can still view and download everything."
            : access.reason === "not_open"
              ? "The host is still setting it up. Check back closer to the event."
              : "Ask the organizer for access."}
        </p>
      </div>
    );
  }

  const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
  const guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
  const hasConsented = Boolean(guestSession && guestSession.eventId === event.id);

  if (!hasConsented && !isOwner) {
    return <EntrySheet slug={slug} eventName={event.name} requiresPassword={false} />;
  }

  // GRW-7: an open by someone other than the event's team. Counted after the
  // page has gone, so a guest is never kept waiting on a statistic.
  if (!isOwner) after(() => countGalleryOpen(event.id).catch(() => {}));

  // Taken before the query, so anything that changes while it runs is sent
  // again by the first poll rather than falling between the two.
  const syncedAt = new Date().toISOString();
  const initialMedia = await toGalleryMedia(
    await fetchGalleryMedia(event.id, {
      isOwner,
      guestId: guestSession?.guestId,
      event,
      limit: 60,
    }),
    event.slug,
  );
  const [albumRows, coverRows] = await Promise.all([
    canUseAlbums(plan.key)
      ? db.select().from(albums).where(and(eq(albums.eventId, event.id), isNull(albums.deletedAt))).orderBy(albums.createdAt)
      : Promise.resolve([]),
    canCustomizeGallery(plan.key) && event.coverMediaId
      ? db
          .select()
          .from(media)
          .where(and(eq(media.id, event.coverMediaId), isNull(media.deletedAt)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  // The cover is chosen by the host from the gallery, so whoever can see the
  // gallery can see it. Signed like a tile, for the same reason. A video cover
  // shows its poster; the route URL it used to get was a video handed to an
  // <img>, which rendered nothing.
  const coverUrls = coverRows[0] ? await signMediaUrls(coverRows[0]) : null;
  const coverUrl = coverUrls ? (coverUrls.src ?? coverUrls.posterSrc) : null;

  const galleryFull = eventUsage(event, plan).full;
  // CAM-4: the guest's roll, when the event is a disposable camera.
  const shotsUsed =
    event.disposableMode && guestSession?.guestId
      ? ((
          await db
            .select({ shotsUsed: guests.shotsUsed })
            .from(guests)
            .where(eq(guests.id, guestSession.guestId))
            .limit(1)
        )[0]?.shotsUsed ?? 0)
      : 0;
  const disposable = event.disposableMode
    ? {
        shotsPerGuest: event.shotsPerGuest,
        shotsLeft: Math.max(0, event.shotsPerGuest - shotsUsed),
        developsAt: event.developsAt?.toISOString() ?? null,
        developed: !rollUndeveloped(event),
      }
    : null;
  const publicEvent = toPublicEvent({
    ...event,
    coverMediaId: canCustomizeGallery(plan.key) ? event.coverMediaId : null,
    accentColor: canCustomizeGallery(plan.key) ? event.accentColor : "#edee00",
    backgroundColor: canCustomizeGallery(plan.key) ? event.backgroundColor : "#050505",
    // PAY-7: a full gallery offers no upload button at all, rather than one
    // that fails. The banner below says why.
    uploadsEnabled: canUpload(event) && !galleryFull,
  });

  return (
    <GuestGallery
      event={publicEvent}
      isOwner={isOwner}
      initialMedia={initialMedia}
      syncedAt={syncedAt}
      albums={albumRows}
      coverUrl={coverUrl}
      canSlideshow={canUseSlideshow(plan.key)}
      maxVideoSeconds={plan.maxVideoSeconds}
      showBranding={!removesKlikBranding(plan.key)}
      galleryFull={galleryFull && canUpload(event)}
      disposable={disposable}
    />
  );
}
