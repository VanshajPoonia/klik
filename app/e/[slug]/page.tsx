import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
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
import { EntrySheet } from "@/components/guest/entry-sheet";
import { GuestGallery } from "@/components/guest/guest-gallery";

export default async function GuestEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  if (!event) notFound();
  const plan = await getAccountPlan(event.ownerId);

  const session = await auth();
  const isOwner = Boolean(
    session?.user && (session.user.id === event.ownerId || session.user.role === "superadmin"),
  );

  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie ? await verifyEventUnlock(unlockCookie, event.id) : false;

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

  const initialMedia = await fetchGalleryMedia(event.id, {
    isOwner,
    guestId: guestSession?.guestId,
    limit: 60,
  });

  const publicEvent = toPublicEvent({
    ...event,
    uploadsEnabled: canUpload(event, plan.uploadWindowDays),
  });

  return <GuestGallery event={publicEvent} isOwner={isOwner} initialMedia={initialMedia} />;
}
