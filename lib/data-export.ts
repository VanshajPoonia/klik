import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  accountCredits,
  accountTimeline,
  accounts,
  entitlements,
  eventCoHosts,
  events,
  guests,
  media,
  mediaComments,
  mediaReactions,
  referrals,
  userPasskeys,
  users,
  watermarks,
} from "./schema";
import { zipEntryName } from "./download-batches";
import type { ZipItem } from "./zip-stream";

/**
 * TRS-2: "download everything you have on me". Two shapes, because there are
 * two kinds of person here.
 *
 * - **An account** gets one JSON file of what is held about it. Not the photos
 *   of events it runs: those are the event's, already downloadable from each
 *   event, and can be many gigabytes. Each gallery it joined as a guest links
 *   to that guest's own download.
 * - **A guest**, account or not, gets a ZIP of what they shared at one event,
 *   with a `data.json` beside the files: their name there, when they agreed to
 *   what, and their comments and hearts.
 *
 * Never included: password hashes, passkey keys, other people's names (who
 * they referred, who hid their comment), or internal ids beyond the photo's.
 */

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export async function accountExport(userId: string, appUrl: string) {
  const [account] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return null;

  const [linked, passkeys, plans, history, owned, teams, joined, credits, referralCounts, watermark, comments] = await Promise.all([
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)),
    db.select().from(userPasskeys).where(eq(userPasskeys.userId, userId)).orderBy(asc(userPasskeys.createdAt)),
    db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(asc(entitlements.createdAt)),
    db.select().from(accountTimeline).where(eq(accountTimeline.userId, userId)).orderBy(asc(accountTimeline.createdAt)),
    db
      .select({
        name: events.name,
        slug: events.slug,
        eventDate: events.eventDate,
        createdAt: events.createdAt,
        visibility: events.visibility,
        mediaCount: events.mediaCount,
        deletedAt: events.deletedAt,
        clientName: events.clientName,
        clientEmail: events.clientEmail,
        clientPhone: events.clientPhone,
      })
      .from(events)
      .where(eq(events.ownerId, userId))
      .orderBy(asc(events.createdAt)),
    db
      .select({ name: events.name, slug: events.slug, role: eventCoHosts.role, since: eventCoHosts.createdAt })
      .from(eventCoHosts)
      .innerJoin(events, eq(events.id, eventCoHosts.eventId))
      .where(and(eq(eventCoHosts.userId, userId), isNull(eventCoHosts.deletedAt))),
    db
      .select({
        name: events.name,
        slug: events.slug,
        displayName: guests.displayName,
        joinedAt: guests.createdAt,
        consentedAt: guests.consentedAt,
        consentVersion: guests.consentVersion,
        uploads: sql<number>`(SELECT count(*)::int FROM ${media} WHERE ${media.guestId} = ${guests.id})`,
      })
      .from(guests)
      .innerJoin(events, eq(events.id, guests.eventId))
      .where(eq(guests.userId, userId)),
    db.select().from(accountCredits).where(eq(accountCredits.userId, userId)).orderBy(asc(accountCredits.createdAt)),
    db
      .select({ invited: sql<number>`count(*)::int`, wentLive: sql<number>`count(${referrals.qualifiedAt})::int` })
      .from(referrals)
      .where(eq(referrals.referrerId, userId)),
    db.select().from(watermarks).where(eq(watermarks.userId, userId)).limit(1),
    db
      .select({ body: mediaComments.body, createdAt: mediaComments.createdAt, hiddenAt: mediaComments.hiddenAt, mediaId: mediaComments.mediaId, slug: events.slug })
      .from(mediaComments)
      .innerJoin(events, eq(events.id, mediaComments.eventId))
      .where(eq(mediaComments.userId, userId))
      .orderBy(asc(mediaComments.createdAt)),
  ]);
  const [referredBy] = await db.select({ at: referrals.createdAt }).from(referrals).where(eq(referrals.referredId, userId)).limit(1);

  return {
    about:
      "Everything Klik holds about your account, as of exportedAt. Photos and videos in the events you run are not in this file: download them from each event. What you shared as a guest is at each gallery's download link below.",
    exportedAt: new Date().toISOString(),
    account: {
      name: account.name,
      email: account.email,
      emailVerifiedAt: iso(account.emailVerified),
      username: account.username,
      usernameChangedAt: iso(account.usernameChangedAt),
      createdAt: iso(account.createdAt),
      role: account.role,
      activatedAt: iso(account.activatedAt),
      cameToRunEventsAt: iso(account.organizerIntentAt),
      publicProfile: { isPublic: account.profilePublic, about: account.profileBio, website: account.profileWebsite },
      referralLink: `${appUrl}/r/${account.referralCode}`,
      joinedThroughAReferral: Boolean(referredBy),
    },
    signingIn: {
      hasPassword: Boolean(account.passwordHash),
      linkedProviders: [...new Set(linked.map((row) => row.provider))],
      passkeys: passkeys.map((key) => ({
        name: key.name,
        syncedAcrossDevices: key.deviceType === "multiDevice",
        createdAt: iso(key.createdAt),
        lastUsedAt: iso(key.lastUsedAt),
      })),
    },
    plans: plans.map((plan) => ({
      plan: plan.planKey,
      scope: plan.scope,
      status: plan.status,
      grantedAt: iso(plan.createdAt),
      reason: plan.reason,
      endsAt: iso(plan.endsAt),
      usedAt: iso(plan.appliedAt),
    })),
    history: history.map((entry) => ({ what: entry.kind, detail: entry.detail, at: iso(entry.createdAt) })),
    eventsYouRun: owned.map((event) => ({
      name: event.name,
      address: `${appUrl}/e/${event.slug}`,
      eventDate: iso(event.eventDate),
      createdAt: iso(event.createdAt),
      visibility: event.visibility,
      photosAndVideos: event.mediaCount,
      inTrash: Boolean(event.deletedAt),
      client: event.clientName || event.clientEmail || event.clientPhone ? { name: event.clientName, email: event.clientEmail, phone: event.clientPhone } : null,
    })),
    eventsYouHelpWith: teams.map((team) => ({ name: team.name, address: `${appUrl}/e/${team.slug}`, role: team.role, since: iso(team.since) })),
    galleriesYouJoined: joined.map((guest) => ({
      name: guest.name,
      address: `${appUrl}/e/${guest.slug}`,
      yourName: guest.displayName,
      joinedAt: iso(guest.joinedAt),
      consent: { version: guest.consentVersion, agreedAt: iso(guest.consentedAt) },
      photosAndVideosYouShared: guest.uploads,
      downloadWhatYouShared: `${appUrl}/api/e/${guest.slug}/me/export`,
    })),
    commentsYouWrote: comments.map((comment) => ({
      text: comment.body,
      onPhoto: `${appUrl}/e/${comment.slug}?m=${comment.mediaId}`,
      at: iso(comment.createdAt),
      hidden: Boolean(comment.hiddenAt),
    })),
    watermark: watermark[0]
      ? {
          words: watermark[0].label,
          typeface: watermark[0].font,
          position: watermark[0].position,
          strength: watermark[0].opacity,
          size: watermark[0].scale,
          buyNote: watermark[0].buyNote,
          buyLink: watermark[0].buyUrl,
          hasLogo: Boolean(watermark[0].logoKey),
        }
      : null,
    referrals: {
      peopleInvited: referralCounts[0]?.invited ?? 0,
      wentLive: referralCounts[0]?.wentLive ?? 0,
      credit: credits.map((row) => ({ amountCents: row.amountCents, reason: row.reason, at: iso(row.createdAt) })),
    },
  };
}

/** One guest's share of one event: the JSON, and the files to stream beside it. */
export async function guestExport(guestId: string, appUrl: string) {
  const [guest] = await db
    .select({
      id: guests.id,
      displayName: guests.displayName,
      createdAt: guests.createdAt,
      consentedAt: guests.consentedAt,
      consentVersion: guests.consentVersion,
      shotsUsed: guests.shotsUsed,
      eventId: guests.eventId,
      userId: guests.userId,
      eventName: events.name,
      slug: events.slug,
      disposable: events.disposableMode,
    })
    .from(guests)
    .innerJoin(events, eq(events.id, guests.eventId))
    .where(eq(guests.id, guestId))
    .limit(1);
  if (!guest) return null;

  const [uploads, comments, hearts] = await Promise.all([
    // The trash too: it is still held, so it is still theirs to have.
    db.select().from(media).where(eq(media.guestId, guestId)).orderBy(asc(media.createdAt)),
    // Comments need an account (C-5), so they are the linked account's, here.
    guest.userId
      ? db
          .select({ body: mediaComments.body, createdAt: mediaComments.createdAt, mediaId: mediaComments.mediaId, hiddenAt: mediaComments.hiddenAt })
          .from(mediaComments)
          .where(and(eq(mediaComments.userId, guest.userId), eq(mediaComments.eventId, guest.eventId)))
          .orderBy(asc(mediaComments.createdAt))
      : Promise.resolve([]),
    db
      .select({ mediaId: mediaReactions.mediaId, createdAt: mediaReactions.createdAt })
      .from(mediaReactions)
      .where(eq(mediaReactions.guestId, guestId))
      .orderBy(desc(mediaReactions.createdAt)),
  ]);

  const items: ZipItem[] = uploads.map((row) => ({ id: row.id, kind: row.kind, mimeType: row.mimeType, blobPathname: row.blobPathname }));
  const data = {
    about: "What you shared at this gallery, as of exportedAt. Your photos and videos are the numbered files beside this one.",
    exportedAt: new Date().toISOString(),
    gallery: { name: guest.eventName, address: `${appUrl}/e/${guest.slug}` },
    you: {
      nameInThisGallery: guest.displayName,
      joinedAt: iso(guest.createdAt),
      consent: { version: guest.consentVersion, agreedAt: iso(guest.consentedAt) },
      ...(guest.disposable ? { shotsTaken: guest.shotsUsed } : {}),
    },
    photosAndVideos: uploads.map((row, index) => ({
      file: zipEntryName(index, row),
      kind: row.kind,
      uploadedAt: iso(row.createdAt),
      takenAt: row.capturedAt,
      status: row.status,
      whoCanSeeIt: row.visibility,
      inTheHostsTrash: Boolean(row.deletedAt),
    })),
    commentsYouWrote: comments.map((comment) => ({ text: comment.body, onPhoto: comment.mediaId, at: iso(comment.createdAt), hidden: Boolean(comment.hiddenAt) })),
    photosYouHearted: hearts.map((heart) => ({ photo: heart.mediaId, at: iso(heart.createdAt) })),
  };
  return { guest, items, data };
}

/** The guest row a signed-in account holds at one event, for downloading from /me. */
export async function accountGuestAt(userId: string, eventId: string) {
  const [row] = await db
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.userId, userId), eq(guests.eventId, eventId), isNotNull(guests.userId)))
    .limit(1);
  return row?.id ?? null;
}

