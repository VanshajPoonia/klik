import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { albums, eventCoHosts, events, media, users, venueClients } from "@/lib/schema";
import { toOrganizerEvent } from "@/lib/events";
import { getAppUrl } from "@/lib/env";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { getAccountEntitlements } from "@/lib/entitlements";
import { openReportCounts } from "@/lib/reports";
import { COMMENT_REPORT_LABELS, reportedComments, type CommentReportReason } from "@/lib/comments";
import { eventUsage } from "@/lib/usage";
import { listFormerSlugs } from "@/lib/slugs";
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
import { signMediaUrls } from "@/lib/media-urls";
import { EventDashboard } from "@/components/dashboard/event-dashboard";
import { SupportCard } from "@/components/dashboard/support-card";
import { resolveEventActor } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { openInvites } from "@/lib/team";
import { eventActivity } from "@/lib/activity";

export const metadata: Metadata = {
  title: "Manage event",
  robots: { index: false },
};

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) notFound();
  // Resolved once, as the actor rather than as a bare session, so the page can
  // ask what this person may actually do instead of only whether they are on the
  // team. The coarse check was already wrong for the Links tab: a moderator is a
  // manager by that measure and must not be able to mint share links.
  const actor = await resolveEventActor(event.id, event.ownerId);
  if (!actor) notFound();

  const plan = eventPlan(event);
  const licenseState = eventLicenseState(event);
  // ORG-2: managers add and invite too, as the route has always allowed. The
  // owner alone removes people and hands the event over.
  const isOwner = actor.role === "owner";
  const canManageTeam = canUseCoHosts(plan.key) && can(actor.role, "cohosts.manage");
  const canModerateComments = can(actor.role, "media.moderate");
  const [reportCounts, formerSlugs, invites, activity, offeredBy, commentReports] = await Promise.all([
    openReportCounts(event.id),
    listFormerSlugs(event.id),
    canManageTeam ? openInvites(event.id) : Promise.resolve([]),
    can(actor.role, "cohosts.manage") ? eventActivity(event.id) : Promise.resolve(null),
    // ORG-4: the event has been offered to whoever is looking at it.
    event.transferToUserId === session.user.id
      ? db
          .select({ name: users.name, username: users.username })
          .from(users)
          .where(eq(users.id, event.ownerId))
          .limit(1)
          .then(([owner]) => owner?.name ?? (owner?.username ? `@${owner.username}` : "The owner"))
      : Promise.resolve(null),
    canModerateComments ? reportedComments(event.id) : Promise.resolve([]),
  ]);
  const [mediaRows, albumRows, coHostRows, clientRows, held] = await Promise.all([
    db
      .select()
      .from(media)
      .where(and(eq(media.eventId, id), isNull(media.deletedAt)))
      .orderBy(desc(media.createdAt))
      // Signed once here, like the guest gallery, so a grid of hundreds of
      // tiles is not hundreds of authorized round trips to the content route.
      .then((rows) =>
        Promise.all(
          rows.map(async (item) => ({
            ...withProtectedMediaUrl(item, event.slug),
            ...(await signMediaUrls(item)),
            openReports: reportCounts.get(item.id) ?? 0,
          })),
        ),
      ),
    db.select().from(albums).where(and(eq(albums.eventId, id), isNull(albums.deletedAt), eq(albums.kind, "manual"))).orderBy(albums.position, albums.createdAt),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        username: users.username,
        role: eventCoHosts.role,
      })
      .from(eventCoHosts)
      .innerJoin(users, eq(users.id, eventCoHosts.userId))
      .where(and(eq(eventCoHosts.eventId, id), isNull(eventCoHosts.deletedAt)))
      .orderBy(eventCoHosts.createdAt),
    db
      .select()
      .from(venueClients)
      .where(and(eq(venueClients.ownerId, event.ownerId), isNull(venueClients.deletedAt)))
      .orderBy(venueClients.name),
    // Only needed to offer "go live" on a draft or lapsed event.
    licenseState === "live" ? null : getAccountEntitlements(event.ownerId),
  ]);

  const guestUrl = `${getAppUrl()}/e/${event.slug}`;
  const backHref = session.user.role === "superadmin" ? "/admin" : "/dashboard";
  return (
    // Support sits outside EventDashboard rather than inside it. That component
    // is a tabbed client view with its own modals, and where a help card belongs
    // in it depends on which tab is open. Below it is a footer, which is where
    // someone looks for a phone number anyway.
    <>
      <EventDashboard
        event={toOrganizerEvent(event)}
        initialMedia={mediaRows}
        guestUrl={guestUrl}
        backHref={backHref}
        canManageClients={canManageEventClients(plan.key)}
        canSlideshow={canUseSlideshow(plan.key)}
        canManageAlbums={canUseAlbums(plan.key)}
        canManageCoHosts={canManageTeam}
        canManageShares={can(actor.role, "shares.manage")}
        canManageTrash={can(actor.role, "trash.manage")}
        canModerateComments={canModerateComments}
        reportedComments={commentReports.map((row) => ({
          commentId: row.commentId,
          mediaId: row.mediaId,
          body: row.body,
          authorName: row.authorName,
          hidden: row.hidden,
          reasons: row.reasons.map((reason) => COMMENT_REPORT_LABELS[reason as CommentReportReason] ?? reason),
          count: row.count,
          safetyHold: row.safetyHold,
        }))}
        addressing={plan.key !== "event" ? { origin: getAppUrl(), formerSlugs } : null}
        usage={(() => {
          const usage = eventUsage(event, plan);
          return {
            bytes: usage.bytes,
            storageLimit: usage.storageLimit,
            storagePercent: usage.storagePercent,
            count: usage.count,
            photoHeadline: usage.photoHeadline,
            level: usage.level,
            uploadDaysLeft: usage.uploadDaysLeft,
          };
        })()}
        canCustomizeGallery={canCustomizeGallery(plan.key)}
        canCustomizeQr={canCustomizeQr(plan.key)}
        canDownloadQrSign={canDownloadQrSign(plan.key)}
        canUseVenueHub={canUseVenueHub(plan.key)}
        license={{
          state: licenseState,
          canGoLive: Boolean(held && (held.unusedPasses.length > 0 || held.accountGrants.length > 0)),
          requestedAt: event.activationRequestedAt
            ? event.activationRequestedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : null,
        }}
        canDeleteEvent={
          session.user.id === event.ownerId || session.user.role === "superadmin"
        }
        albums={albumRows}
        coHosts={coHostRows}
        team={{
          isOwner,
          invites: invites.map((invite) => ({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt.toISOString(),
          })),
          transferTo: isOwner ? event.transferToUserId : null,
        }}
        activity={activity}
        transferOffer={offeredBy ? { fromName: offeredBy } : null}
        clients={clientRows}
      />
      <div className="mx-auto w-full max-w-5xl px-6 pb-10 md:px-10">
        <SupportCard />
      </div>
    </>
  );
}
