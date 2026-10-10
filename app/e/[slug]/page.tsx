import { cache } from "react";
import { after } from "next/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { guests, media, users } from "@/lib/schema";
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
  canUseProofs,
  removesKlikBranding,
} from "@/lib/plans";
import { resolveEventActor } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { claimGuestCookies } from "@/lib/guest-accounts";
import { reactorFor, withViewerReactions } from "@/lib/reactions";
import { galleryFolderPayload, galleryMoments } from "@/lib/folders";
import { linkedMediaId } from "@/lib/media-share";
import { activeKiosk } from "@/lib/kiosks";
import { challengeBoard } from "@/lib/challenges";
import { getWatermark } from "@/lib/proofs";
import { EntrySheet } from "@/components/guest/entry-sheet";
import { isRecapAvailable } from "@/lib/recap";
import { GuestGallery } from "@/components/guest/guest-gallery";
import { GuestCopyProvider } from "@/components/guest/guest-copy";
import { GUEST_COPY } from "@/lib/i18n/guest";
import { LOCALE_COOKIE, chooseLocale } from "@/lib/i18n/locale";

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

export default async function GuestEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { slug } = await params;
  // CAM-3: a link to one photo. It opens the gallery like any other visit, so
  // the password, the entry sheet and the access rule all still stand.
  const linkedId = linkedMediaId((await searchParams).m);
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const plan = eventPlan(event);

  // The actor rather than the bare session, so the gallery can offer each team
  // member what their role allows: a contributor sees hidden comments, as they
  // see private photos, but only a moderator or above can hide one (MED-9).
  const actor = await resolveEventActor(event.id, event.ownerId);
  const managerSession = actor?.session ?? null;
  const isOwner = Boolean(managerSession);

  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie
    ? await verifyEventUnlock(unlockCookie, event.id, event.accessVersion)
    : false;

  const access = canViewGallery(event, { isOwner, hasUnlockCookie });

  // TRS-3: the guest's own choice, then the host's, then the browser's.
  const locale = chooseLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    eventLanguage: event.guestLanguage,
    acceptLanguage: (await headers()).get("accept-language"),
  });
  const copy = GUEST_COPY[locale];
  const speak = (node: React.ReactNode) => (
    <GuestCopyProvider locale={locale}>
      <div lang={locale}>{node}</div>
    </GuestCopyProvider>
  );

  // GRW-1: offered only where the host allows it and Klik can send it.
  const offerRecap = event.recapEnabled && isRecapAvailable();

  if (!access.allowed) {
    if (access.reason === "password_required") {
      return speak(<EntrySheet slug={slug} eventName={event.name} requiresPassword offerRecap={offerRecap} />);
    }
    return speak(
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-2xl text-paper">
          {access.reason === "expired"
            ? copy.gate.endedTitle
            : access.reason === "not_open"
              ? copy.gate.notOpenTitle
              : access.reason === "suspended"
                ? copy.gate.pausedTitle
                : copy.gate.privateTitle}
        </h1>
        <p className="mt-3 max-w-sm text-sm text-muted">
          {access.reason === "expired"
            ? copy.gate.endedBody
            : access.reason === "not_open"
              ? copy.gate.notOpenBody
              : access.reason === "suspended"
                ? copy.gate.pausedBody
                : copy.gate.privateBody}
        </p>
      </div>,
    );
  }

  const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
  let guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
  // VEN-2: a kiosk takes photos and does nothing else, so it is sent back to
  // its own screen. One that has been switched off is nobody at all.
  if (!isOwner && guestSession?.kioskId && guestSession.eventId === event.id) {
    if (await activeKiosk({ kioskId: guestSession.kioskId, guestId: guestSession.guestId, eventId: event.id })) {
      redirect(`/e/${event.slug}/kiosk`);
    }
    guestSession = null;
  }
  const hasConsented = Boolean(guestSession && guestSession.eventId === event.id);

  if (!hasConsented && !isOwner) {
    return speak(<EntrySheet slug={slug} eventName={event.name} requiresPassword={false} offerRecap={offerRecap} />);
  }

  // GRW-7: an open by someone other than the event's team. Counted after the
  // page has gone, so a guest is never kept waiting on a statistic.
  if (!isOwner) after(() => countGalleryOpen(event.id).catch(() => {}));

  // ACC-3: a signed-in guest's anonymous cookie becomes theirs, so the gallery
  // is on their account from now on. After the response, and idempotent.
  const account = isOwner ? null : await auth();
  const signedInUserId = account?.user?.id ?? null;
  if (signedInUserId && guestCookie) {
    const cookie = { name: guestCookieName(event.id), value: guestCookie };
    after(() => claimGuestCookies(signedInUserId, [cookie]).catch(() => {}));
  }

  const viewerReactor = reactorFor({ guestId: guestSession?.guestId ?? null, userId: managerSession?.user?.id ?? null });
  // Taken before the query, so anything that changes while it runs is sent
  // again by the first poll rather than falling between the two.
  const syncedAt = new Date().toISOString();
  const initialMedia = await withViewerReactions(
    await toGalleryMedia(
      await fetchGalleryMedia(event.id, {
        isOwner,
        guestId: guestSession?.guestId,
        event,
        limit: 60,
      }),
      event.slug,
    ),
    event,
    viewerReactor,
  );
  const [folders, moments, coverRows, linkedRows, board] = await Promise.all([
    // MED-4. A roll that has not developed shows guests nothing, folders
    // included: a tab per folder would say what is coming.
    canUseAlbums(plan.key) && (isOwner || !rollUndeveloped(event))
      ? galleryFolderPayload(event.id, { isManager: isOwner })
      : Promise.resolve([]),
    // AI-1. Not before a roll develops either, for the same reason.
    isOwner || !rollUndeveloped(event) ? galleryMoments(event, { isManager: isOwner }) : Promise.resolve([]),
    canCustomizeGallery(plan.key) && event.coverMediaId
      ? db
          .select()
          .from(media)
          .where(and(eq(media.id, event.coverMediaId), isNull(media.deletedAt)))
          .limit(1)
      : Promise.resolve([]),
    // The same query and rule as the grid, narrowed to the one row, so a link
    // can never show what the grid would not.
    linkedId && !initialMedia.some((item) => item.id === linkedId)
      ? fetchGalleryMedia(event.id, { isOwner, guestId: guestSession?.guestId, event, id: linkedId, limit: 1 })
      : Promise.resolve([]),
    // GRW-3. Counted as everyone sees them; the ticks are this guest's own.
    challengeBoard(event, { guestId: isOwner ? null : (guestSession?.guestId ?? null) }),
  ]);
  const linked =
    initialMedia.find((item) => item.id === linkedId) ??
    (linkedRows.length > 0
      ? (await withViewerReactions(await toGalleryMedia(linkedRows, event.slug), event, viewerReactor))[0]
      : null);
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

  // MED-10: a photographer on the team can send their photos as watermarked
  // proofs, once they have a watermark. Nobody else is offered it.
  const watermark =
    managerSession?.user?.id && canUseProofs(plan.key) && canUpload(event) ? await getWatermark(managerSession.user.id) : null;
  const proofs =
    managerSession?.user?.id && canUseProofs(plan.key) && canUpload(event) ? { label: watermark?.label ?? null } : null;

  // GRW-5: the guest who wants one of these for their own event got here
  // through this host, so the link says so. Only where Klik branding shows.
  const [host] = !removesKlikBranding(plan.key) && !isOwner
    ? await db.select({ code: users.referralCode }).from(users).where(eq(users.id, event.ownerId)).limit(1)
    : [];

  return speak(
    <GuestGallery
      event={publicEvent}
      proofs={proofs}
      referralHref={host ? `/r/${host.code}` : null}
      keepPhotoDetails={isOwner && event.keepPhotoDetails && canUseProofs(plan.key)}
      isOwner={isOwner}
      initialMedia={initialMedia}
      syncedAt={syncedAt}
      folders={folders}
      moments={moments}
      coverUrl={coverUrl}
      canSlideshow={canUseSlideshow(plan.key)}
      maxVideoSeconds={plan.maxVideoSeconds}
      showBranding={!removesKlikBranding(plan.key)}
      galleryFull={galleryFull && canUpload(event)}
      disposable={disposable}
      signedIn={Boolean(signedInUserId)}
      canModerateComments={Boolean(actor && can(actor.role, "media.moderate"))}
      linked={linked}
      board={board}
      linkedMissing={Boolean(linkedId && !linked)}
    />,
  );
}
