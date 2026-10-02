import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { canUpload, canViewGallery } from "@/lib/access";
import { getAccountPlan } from "@/lib/account-plans";
import {
  guestCookieName,
  verifyGuestSession,
  eventUnlockCookieName,
  verifyEventUnlock,
} from "@/lib/guest";
import { toPublicEvent } from "@/lib/events";
import { fetchGalleryMedia } from "@/lib/media";
import { toPublicMedia, withProtectedMediaUrl } from "@/lib/media-delivery";
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
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1);
  return event ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  return { title: event?.name, robots: { index: false } };
}

export default async function GuestEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const plan = await getAccountPlan(event.ownerId);

  const managerSession = await requireEventManagerSession(event.id, event.ownerId);
  const isOwner = Boolean(managerSession);

  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie
    ? await verifyEventUnlock(unlockCookie, event.id, event.accessVersion)
    : false;

  const access = canViewGallery(event, {
    isOwner,
    hasUnlockCookie,
    galleryAccessDays: plan.galleryAccessDays,
  });

  if (!access.allowed) {
    if (access.reason === "password_required") {
      return <EntrySheet slug={slug} eventName={event.name} requiresPassword />;
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-2xl text-paper">
          {access.reason === "expired" ? "This event has ended." : "This gallery is private."}
        </h1>
        <p className="mt-3 max-w-sm text-sm text-muted">
          {access.reason === "expired"
            ? "Uploads are closed, but the organizer can still view and download everything."
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

  const initialMedia = (
    await fetchGalleryMedia(event.id, {
      isOwner,
      guestId: guestSession?.guestId,
      event,
      limit: 60,
    })
  ).map((item) => toPublicMedia(item, event.slug));
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
  const coverUrl = coverRows[0]
    ? withProtectedMediaUrl(coverRows[0], event.slug).blobUrl
    : null;

  const publicEvent = toPublicEvent({
    ...event,
    coverMediaId: canCustomizeGallery(plan.key) ? event.coverMediaId : null,
    accentColor: canCustomizeGallery(plan.key) ? event.accentColor : "#edee00",
    backgroundColor: canCustomizeGallery(plan.key) ? event.backgroundColor : "#050505",
    uploadsEnabled: canUpload(event, plan.uploadWindowDays),
  });

  return (
    <GuestGallery
      event={publicEvent}
      isOwner={isOwner}
      initialMedia={initialMedia}
      albums={albumRows}
      coverUrl={coverUrl}
      canSlideshow={canUseSlideshow(plan.key)}
      maxVideoSeconds={plan.maxVideoSeconds}
      showBranding={!removesKlikBranding(plan.key)}
    />
  );
}
