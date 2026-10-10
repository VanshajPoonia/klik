import type { AssignableRole } from "./permissions";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  bigint,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { PlanKey } from "./plans";
import { sql } from "drizzle-orm";

// --- Auth.js tables (organizers only, guests never get a row here) ---

export const USER_ROLES = ["organizer", "superadmin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { withTimezone: true }),
  image: text("image"),
  role: text("role").$type<UserRole>().notNull().default("organizer"),
  // RETIRED by ACT-1, 2026-10-08. Nothing reads it: what an account holds is
  // the `entitlements` ledger, and what an event runs on is `events.plan_key`.
  // It defaulted to 'event', so it described a $39 plan for every account
  // whether or not anyone had granted it. Kept only until a migration drops it;
  // do not start reading it again.
  planKey: text("plan_key").$type<PlanKey>().notNull().default("event"),
  venueSlug: text("venue_slug").unique(),
  credentialVersion: integer("credential_version").notNull().default(0),
  username: text("username").unique(), // set only for credential-based accounts
  passwordHash: text("password_hash"), // bcrypt, set only alongside username
  /**
   * ACC-2: when this account showed it came to run events, by signing up at
   * /signup or opening a plan's payment link. Null for an account made by a
   * guest signing in to keep a gallery, which is why the admin queue of
   * signups waiting on activation reads this rather than every account.
   */
  organizerIntentAt: timestamp("organizer_intent_at", { withTimezone: true }),
  /** ID-1: when the handle was last chosen. One change per 30 days. */
  usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
  /** GRW-4: whether /u/<username> exists, and what it says. Off by default. */
  profilePublic: boolean("profile_public").notNull().default(false),
  profileBio: text("profile_bio"),
  profileWebsite: text("profile_website"),
  /**
   * GRW-5: this account's referral code, made by the database at insert. Its
   * unique index is in drizzle/0041_referrals.sql.
   */
  referralCode: text("referral_code")
    .notNull()
    .default(sql`substr(md5(random()::text || clock_timestamp()::text), 1, 10)`),
  /**
   * When a superadmin granted this account its plan. Null means the account was
   * created by someone filling in the signup form and is not yet entitled to
   * anything: it can sign in and see its dashboard, and it cannot create an
   * event. See drizzle/0013_self_signup.sql for why this is a column of its own
   * rather than a change to `planKey`.
   */
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  /**
   * When the account was created. Needed to order the queue of signups waiting
   * on a superadmin: the first thing asked about one is how long it has been
   * sitting there.
   */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * When this account was last told, by email, that its access is open.
   *
   * Set by the plan route when activation first happens, and by the resend
   * control on /admin. Null means nobody has been told, which is why it is not
   * backfilled: see drizzle/0014_activation_email.sql.
   *
   * Separate from `activatedAt` because the two genuinely come apart. An account
   * with no email on file can be activated and can never be mailed, and a send
   * can be rejected by the provider long after the plan was granted. Reading
   * activation as proof of notification is how somebody waits for an email that
   * was never sent.
   */
  activationEmailSentAt: timestamp("activation_email_sent_at", { withTimezone: true }),
});

/**
 * The vocabulary `account_timeline.kind` is written with.
 *
 * Not a database CHECK constraint, on purpose: see
 * drizzle/0015_account_timeline.sql. A kind the database refuses is a lost
 * record, and this table exists so records are not lost. Reading code should
 * handle an unknown kind rather than assume this list is exhaustive, because an
 * older deployment can have written one this build has never heard of.
 */
export const TIMELINE_KINDS = [
  "account_created",
  "welcome_email_sent",
  "welcome_email_failed",
  "plan_assigned",
  "plan_changed",
  "plan_revoked",
  "activation_requested",
  "event_went_live",
  "activation_email_sent",
  "activation_email_failed",
  "event_created",
  "password_changed",
  "username_changed",
  "passkey_added",
  "passkey_removed",
  "credit_added",
  "credit_used",
  "grace_email_sent",
  "grace_email_failed",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * What has happened to an account, append-only.
 *
 * Written through `recordAccountEvent` in lib/timeline.ts, which never throws,
 * because nothing here is worth failing a signup or an activation over. Read by
 * /admin to show how far each customer has got and where they are stuck.
 *
 * Rows are never updated. A correction is another row.
 */
export const accountTimeline = pgTable(
  "account_timeline",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Typed for writers, deliberately widened to string for readers. */
    kind: text("kind").$type<TimelineKind | (string & {})>().notNull(),
    detail: text("detail"),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The actor's name at the time, so the history survives them being renamed or removed. */
    actorLabel: text("actor_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_timeline_user_idx").on(table.userId, table.createdAt),
    index("account_timeline_kind_idx").on(table.kind, table.createdAt),
  ],
);

export const accounts = pgTable("accounts", {
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verificationTokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/**
 * ACC-6: a passkey. Not Auth.js's `authenticators` table: sign-in goes through
 * a Credentials provider that checks the signature itself (lib/passkeys.ts),
 * because Auth.js's own WebAuthn provider is experimental and pins an old
 * library. The id is the credential id, base64url.
 */
export const userPasskeys = pgTable(
  "user_passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    deviceType: text("device_type").$type<"singleDevice" | "multiDevice">().notNull(),
    backedUp: boolean("backed_up").notNull().default(false),
    aaguid: text("aaguid"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("user_passkeys_user_idx").on(table.userId, table.createdAt)],
);

// --- Klik domain tables ---

export const EVENT_VISIBILITIES = ["public", "password", "private"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const MEDIA_KINDS = ["photo", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ["pending", "approved", "rejected"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * Who a photo is for. Orthogonal to `status`, which answers whether a moderator
 * approved it. A photo can be approved and private, and conflating the two
 * would mean hiding a photo put it back in the moderation queue.
 */
export const MEDIA_VISIBILITIES = ["gallery", "private", "link"] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];

export const SHARE_SCOPES = ["media", "album", "event", "selection"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export const QR_TEMPLATES = ["classic", "minimal", "bold"] as const;
export type QrTemplate = (typeof QR_TEMPLATES)[number];

export const venueClients = pgTable(
  "venue_clients",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    // Soft delete: a client row carries contact details, and events reference it
    // with ON DELETE SET NULL, so a hard delete silently detached every event
    // that client ever had with no way back.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("venue_clients_owner_idx").on(table.ownerId)],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }),
    clientName: text("client_name"),
    clientEmail: text("client_email"),
    clientPhone: text("client_phone"),
    clientId: text("client_id").references(() => venueClients.id, { onDelete: "set null" }),
    coverMediaId: text("cover_media_id"),
    accentColor: text("accent_color").notNull().default("#e8f000"),
    backgroundColor: text("background_color").notNull().default("#090a08"),
    qrTemplate: text("qr_template").$type<QrTemplate>().notNull().default("classic"),
    venueFeatured: boolean("venue_featured").notNull().default(false),
    visibility: text("visibility").$type<EventVisibility>().notNull().default("public"),
    passwordHash: text("password_hash"),
    // Whether a guest keeps seeing their own upload after it is made private.
    // Default true because the alternative is cruel: someone uploads a photo,
    // the host hides it, and from the guest's side their photo silently
    // vanished with no explanation.
    uploaderSeesOwnPrivate: boolean("uploader_sees_own_private").notNull().default(true),
    accessVersion: integer("access_version").notNull().default(0),
    moderation: boolean("moderation").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    downloadsEnabled: boolean("downloads_enabled").notNull().default(true),
    uploadsEnabled: boolean("uploads_enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Pinned when the event is created, from the owner's plan at that moment,
    // and only ever extended. Retention must not be recomputed from a mutable
    // plan field at purge time: doing so let a downgrade retroactively shorten
    // the window and make media that was safe yesterday eligible for permanent
    // deletion tonight. See ROADMAP.md SEC-1.
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    // Soft delete. Rows stay readable to recovery tooling for 30 days, then the
    // purge cron removes them and their objects for good.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // The latest media.changed_at for this event, kept by the same trigger. It
    // lets a gallery poll answer "nothing changed" from the event row it has
    // to read anyway, without touching the media table at all, which is what
    // makes two hundred phones polling one wedding cheap.
    mediaChangedAt: timestamp("media_changed_at", { withTimezone: true }).notNull().defaultNow(),
    // What licenses this event: a pass bound to it, or an account grant such as
    // Venue. Null means not currently licensed. See lib/entitlements.ts.
    entitlementId: text("entitlement_id"),
    // The plan this event runs on, copied from its entitlement when licensed so
    // the hot paths read one column on a row they already have instead of
    // walking the ledger. Kept after a licence lapses, so a lapsed gallery can
    // still answer how long it stays viewable.
    planKey: text("plan_key").$type<PlanKey>(),
    // When it first went live. Null is a draft: the organizer can set it up,
    // nobody else can see it, and no QR code exists for it yet. Upload and
    // access windows run from here rather than from created_at, so a draft made
    // months before the wedding does not spend its 30 days sitting unused.
    licensedAt: timestamp("licensed_at", { withTimezone: true }),
    // ACT-4: when the organizer asked for this draft to go live. Cleared by
    // nothing: once licensed, licensed_at is what the queue reads instead.
    activationRequestedAt: timestamp("activation_requested_at", { withTimezone: true }),
    // F-4: live media in this event, kept by the triggers in
    // drizzle/0021_usage.sql rather than by the routes, and recomputed nightly
    // so any drift heals. Read for the storage cap and the usage meter.
    mediaCount: integer("media_count").notNull().default(0),
    mediaBytes: bigint("media_bytes", { mode: "number" }).notNull().default(0),
    // PAY-7: the highest storage warning sent (75, 90, 100), so each goes once.
    usageWarnedPercent: integer("usage_warned_percent").notNull().default(0),
    // SEC-1: the nearest retention warning sent (30, 7, 1 days). Null for none.
    retentionWarnedDays: integer("retention_warned_days"),
    // CAM-4: disposable camera mode. Each guest gets `shotsPerGuest` photos, and
    // no guest sees any photo, their own included, until `developsAt` passes.
    // Compared at read time in lib/media-access.ts, so no job has to flip it.
    disposableMode: boolean("disposable_mode").notNull().default(false),
    shotsPerGuest: integer("shots_per_guest").notNull().default(24),
    developsAt: timestamp("develops_at", { withTimezone: true }),
    // GRW-7: gallery page loads by anyone but the event's team, for insights.
    galleryOpens: integer("gallery_opens").notNull().default(0),
    // ORG-4: the owner has offered this event to a member of its team, who has
    // not answered yet. No foreign key in this file because users is declared
    // first; it is in drizzle/0026_team.sql.
    transferToUserId: text("transfer_to_user_id"),
    transferOfferedAt: timestamp("transfer_offered_at", { withTimezone: true }),
    // MED-9: hearts (any guest) and comments (signed-in guests). Both off until
    // the host turns them on. See lib/reactions.ts and lib/comments.ts.
    reactionsEnabled: boolean("reactions_enabled").notNull().default(false),
    commentsEnabled: boolean("comments_enabled").notNull().default(false),
    // AI-1: whether guests see the gallery grouped into moments.
    momentsEnabled: boolean("moments_enabled").notNull().default(true),
    // GRW-3: a ranked list of who has shared most, by display name. Off until
    // the host turns it on. See lib/challenges.ts.
    leaderboardEnabled: boolean("leaderboard_enabled").notNull().default(false),
    // GRW-4: listed on the owner's public profile, by name and date only.
    showOnProfile: boolean("show_on_profile").notNull().default(false),
    // TRS-3: 'auto' follows each guest's browser. See lib/i18n/locale.ts.
    guestLanguage: text("guest_language").$type<"auto" | "en" | "es">().notNull().default("auto"),
    // MED-8: the team's photos keep camera details, never location. lib/exif-scrub.ts.
    keepPhotoDetails: boolean("keep_photo_details").notNull().default(false),
  },
  (table) => [index("events_owner_idx").on(table.ownerId)],
);

/**
 * QR-1: every address an event used to have, which keeps working. The event's
 * current address is `events.slug`. Uniqueness across both, and permanent
 * reservation after an event is deleted, are enforced by triggers in
 * drizzle/0023_slugs.sql. See lib/slugs.ts.
 */
export const eventSlugs = pgTable(
  "event_slugs",
  {
    slug: text("slug").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("event_slugs_event_idx").on(table.eventId)],
);

/** Hashes of every address of every deleted event. Never released. */
export const slugReservations = pgTable("slug_reservations", {
  slugHash: text("slug_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eventCoHosts = pgTable(
  "event_co_hosts",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // What this person may actually do. Before this column a co-host was a
    // boolean, so someone added only to upload could also rotate the QR code
    // and remove the other co-hosts. The matrix lives in lib/permissions.ts;
    // a CHECK constraint in migration 0010 rejects values with no meaning.
    role: text("role").$type<AssignableRole>().notNull().default("manager"),
    // Soft delete, like everything else. Note this row grants ACCESS, so unlike
    // other soft-deleted records a missed filter here does not show stale data,
    // it leaves a removed co-host still able to manage the gallery. That is why
    // exactly one function reads this table for authorization
    // (requireEventManagerSession in lib/roles.ts) and the filter lives there.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index("event_co_hosts_user_idx").on(table.userId),
  ],
);

export const albums = pgTable(
  "albums",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // MED-4: folders nest, three levels at most. The shape is held by a trigger
    // in drizzle/0031_folders.sql, not by the routes. See lib/folder-tree.ts.
    parentId: text("parent_id").references((): AnyPgColumn => albums.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    coverMediaId: text("cover_media_id").references((): AnyPgColumn => media.id, { onDelete: "set null" }),
    // `smart` is AI-4's saved query; nothing makes one yet.
    kind: text("kind").$type<"manual" | "smart">().notNull().default("manual"),
    query: jsonb("query"),
    // Soft delete: media references an album with ON DELETE SET NULL, so a hard
    // delete silently unfiled every photo in it. Sorting 2,000 wedding photos
    // into folders is real work to lose to one mis-tap.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("albums_event_idx").on(table.eventId)],
);

export const guests = pgTable(
  "guests",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    // WHICH consent text this guest agreed to. consented_at alone records when
    // someone ticked a box, not what the box said, so it cannot answer the only
    // question that matters if they later object. See lib/consent.ts.
    consentVersion: text("consent_version"),
    // CAM-4: shots taken on a disposable roll. See events.shots_per_guest.
    shotsUsed: integer("shots_used").notNull().default(0),
    /**
     * ACC-1: the account this guest was signed in as, or that later claimed the
     * guest's cookie. Null is an anonymous guest, which is most of them and
     * always will be: an account is never required to join or upload.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // guests_user_idx is partial and lives in drizzle/0028 (constraint 4).
  (table) => [index("guests_event_idx").on(table.eventId)],
);

export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    guestId: text("guest_id").references(() => guests.id, { onDelete: "set null" }),
    albumId: text("album_id").references(() => albums.id, { onDelete: "set null" }),
    kind: text("kind").$type<MediaKind>().notNull(),
    status: text("status").$type<MediaStatus>().notNull().default("approved"),
    // See MEDIA_VISIBILITIES. Enforced in exactly two places that must agree:
    // the query builder in lib/media.ts and the content delivery route. Both
    // go through lib/media-access.ts so there is one rule, not two.
    visibility: text("visibility").$type<MediaVisibility>().notNull().default("gallery"),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    contentHash: text("content_hash"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationS: real("duration_s"),
    // Small still extracted on the uploader's device at upload time. Lets the
    // gallery grid use preload="none" and a plain image instead of asking the
    // browser for video "metadata", which on iPhone .mov files means reaching
    // to the end of the file for the moov atom. See lib/video-poster.ts.
    posterPathname: text("poster_pathname"),
    // A small rendition for grid tiles: about 480px on the short side, a few
    // tens of kilobytes where the stored photo is a megabyte or more. Made on
    // the uploader's device when it can be, and by the `media.thumbnail` job
    // otherwise. Null means "not made yet", and tiles fall back to the full
    // image, so nothing breaks while a backfill catches up.
    //
    // Every object key column on this table must be listed in
    // `lib/media-objects.ts`, or erasure leaves it behind. A test enforces it.
    thumbPathname: text("thumb_pathname"),
    // When the camera says the photo was taken, as a zone-less wall clock.
    //
    // Deliberately NOT `withTimezone`. EXIF carries no zone, so storing an
    // instant would mean inventing one, and the photos AI-1 groups were taken
    // by people standing in the same room: their cameras agree with each other
    // even when none of them agrees with UTC. See lib/exif.ts.
    //
    // Null is normal and means "we do not know", not "unknown time". It covers
    // every video, every HEIC, every screenshot and anything re-encoded before
    // it reached us. Readers fall back to `created_at`, which is upload time.
    capturedAt: timestamp("captured_at", { mode: "string" }),
    /**
     * MED-8: whether a video's location has been removed. Null for photos and
     * for videos from before drizzle/0029; see that file for the states.
     */
    metadataState: text("metadata_state").$type<"pending" | "clean" | "failed">(),
    // Soft delete. A deleted photo is irreplaceable and the storage to keep it
    // for 30 days is not, so every read path filters on this rather than the
    // row being gone. See ROADMAP.md SEC-4.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // When something a gallery viewer can see last changed: status,
    // visibility, deletion, album, or a rendition arriving. Maintained by a
    // trigger in drizzle/0017_gallery_sync.sql rather than by the routes, so a
    // new route that moderates media cannot forget it. The changes endpoint
    // reads it to send a phone only what moved since it last asked.
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    // TRS-1: set by a child-safety report. While set, nothing in the app may
    // delete this row or its bytes: not the purge, not erasure, not the guest
    // who uploaded it. See lib/reports.ts. Only a superadmin clears it.
    legalHoldAt: timestamp("legal_hold_at", { withTimezone: true }),
    // MED-9: hearts, and comments guests can see (hidden ones excluded). Kept
    // by triggers in drizzle/0030 and never written by app code, so a count is
    // read from the row a grid already has instead of counted per tile.
    reactionCount: integer("reaction_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    // AI-1: written by the `moments.refresh` job, never by a route. The moment
    // is a smart `albums` row; the burst is its first photo's id. See
    // lib/moments.ts and drizzle/0032_moments.sql.
    momentId: text("moment_id").references((): AnyPgColumn => albums.id, { onDelete: "set null" }),
    burstId: text("burst_id"),
    // GRW-3: the challenge it was taken for, set at upload and never after.
    challengeId: text("challenge_id").references((): AnyPgColumn => challenges.id, { onDelete: "set null" }),
    // CAM-2: the photo this is an edited copy of. Editing never changes the
    // original; it makes this row, which keeps the original's place in time.
    derivedFromId: text("derived_from_id").references((): AnyPgColumn => media.id, { onDelete: "set null" }),
    // MED-10: a watermarked proof. While locked, `blobPathname` names the
    // watermarked copy and the clean original is here, read only for
    // `proofBy`. See lib/proofs.ts and drizzle/0039_proofs.sql.
    proofBy: text("proof_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    proofOriginalPathname: text("proof_original_pathname"),
    proofReleasedAt: timestamp("proof_released_at", { withTimezone: true }),
    // AI-7, AI-8: measured once by the `media.analyze` job. lib/image-analysis.ts.
    perceptualHash: text("perceptual_hash"),
    sharpness: real("sharpness"),
    brightness: real("brightness"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    // AI-8: the host pinned it into the highlights or kept it out.
    highlight: text("highlight").$type<"pinned" | "excluded">(),
  },
  (table) => [
    index("media_event_status_created_idx").on(table.eventId, table.status, table.createdAt),
    index("media_event_hash_idx").on(table.eventId, table.contentHash),
    // The soft-delete indexes are PARTIAL (WHERE deleted_at IS NULL / IS NOT
    // NULL) and live in drizzle/0007_soft_delete_indexes.sql, because that is
    // the shape the gallery and purge queries actually need and it keeps both
    // indexes small. They are not declared here: drizzle-kit push would
    // recreate them as full indexes and quietly undo that.
  ],
);

/** GRW-5: who brought whom. See drizzle/0041_referrals.sql. */
export const referrals = pgTable(
  "referrals",
  {
    id: text("id").primaryKey(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredId: text("referred_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  },
  (table) => [index("referrals_referrer_idx").on(table.referrerId, table.createdAt)],
);

/** GRW-5: credit an account is owed, as a ledger. Positive is credit, negative is used. */
export const accountCredits = pgTable(
  "account_credits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    referralId: text("referral_id").references(() => referrals.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_credits_user_idx").on(table.userId, table.createdAt)],
);

export const WATERMARK_POSITIONS = ["center", "bottom-right", "bottom-left", "tiled"] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/**
 * MED-10: a photographer's watermark, one per account. The stamp is a PNG the
 * browser drew from their text and logo; the server lays it over proofs.
 */
export const watermarks = pgTable("watermarks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stampKey: text("stamp_key").notNull().unique(),
  stampWidth: integer("stamp_width").notNull(),
  stampHeight: integer("stamp_height").notNull(),
  logoKey: text("logo_key"),
  label: text("label").notNull(),
  font: text("font").$type<"sans" | "serif">().notNull().default("sans"),
  position: text("position").$type<WatermarkPosition>().notNull().default("bottom-right"),
  opacity: real("opacity").notNull().default(0.5),
  scale: real("scale").notNull().default(0.3),
  buyNote: text("buy_note"),
  buyUrl: text("buy_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Postgres-backed counters for rate limiting. One row per key per window, and
 * `consume()` in lib/ratelimit.ts updates it in a single atomic statement so
 * concurrent requests cannot both read a stale count. Expired rows are swept
 * by the purge cron.
 */
export const ERASURE_SUBJECTS = ["user", "guest", "event"] as const;
export type ErasureSubjectType = (typeof ERASURE_SUBJECTS)[number];

/**
 * Proof that an erasure happened, without keeping the thing that was erased.
 * The subject is stored as a SHA-256 hash rather than an id: the log has to
 * survive the deletion to be useful, and a raw identifier would recreate in
 * the audit trail exactly the record the request was meant to remove.
 */
export const erasureLog = pgTable("erasure_log", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type").$type<ErasureSubjectType>().notNull(),
  subjectHash: text("subject_hash").notNull(),
  mediaDeleted: integer("media_deleted").notNull().default(0),
  bytesDeleted: bigint("bytes_deleted", { mode: "number" }).notNull().default(0),
  requestedBy: text("requested_by"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

/**
 * A share link. One row per link, never per view.
 *
 * `mediaId`, `albumId` and `scope` are separate rather than one polymorphic
 * target column, so the foreign keys still do their job: deleting a photo takes
 * its links with it, which is the behaviour you want and the behaviour a
 * polymorphic column cannot give you.
 */
export const mediaShares = pgTable(
  "media_shares",
  {
    id: text("id").primaryKey(),
    // Looked up by token alone, so it must reveal nothing about its target: no
    // event slug, no media id, nothing enumerable.
    token: text("token").notNull().unique(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mediaId: text("media_id").references(() => media.id, { onDelete: "cascade" }),
    albumId: text("album_id").references(() => albums.id, { onDelete: "cascade" }),
    scope: text("scope").$type<ShareScope>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByGuestId: text("created_by_guest_id").references(() => guests.id, {
      onDelete: "set null",
    }),
    allowDownload: boolean("allow_download").notNull().default(false),
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxViews: integer("max_views"),
    viewCount: integer("view_count").notNull().default(0),
    // Revocation is instant and permanent, and deliberately NOT a soft delete.
    // A revoked link is kept precisely so the record of it having existed, and
    // of having been withdrawn, survives.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_shares_event_idx").on(table.eventId, table.createdAt),
    index("media_shares_media_idx").on(table.mediaId),
    index("media_shares_album_idx").on(table.albumId),
  ],
);

/**
 * The photos in a `selection` share link, fixed when the link is made. A
 * selection is not a folder: a photo lives in one folder, and a hidden folder
 * for the link would move the photos out of the host's own.
 */
export const mediaShareItems = pgTable(
  "media_share_items",
  {
    shareId: text("share_id")
      .notNull()
      .references(() => mediaShares.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.shareId, table.mediaId] }),
    index("media_share_items_media_idx").on(table.mediaId),
  ],
);

/**
 * Stripe bookkeeping. See ROADMAP.md PAY-2.
 *
 * These tables record money. They do not grant capability: that stays with the
 * superadmin and `users.planKey` until ACT-1's entitlement ledger lands. A
 * webhook writing capability directly is what silently downgrades a comped
 * venue when a subscription lapses.
 */

export const stripeCustomers = pgTable("stripe_customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const PURCHASE_STATUSES = ["paid", "refunded"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Null until the pass is applied. A pass is bought before the event exists,
    // so this cannot be required at purchase time.
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    // Unique, and that is what makes fulfilment idempotent under Stripe's
    // at-least-once delivery.
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    planKey: text("plan_key").$type<PlanKey>().notNull(),
    // Minor units as an integer. Money is never a float.
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").$type<PurchaseStatus>().notNull().default("paid"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("purchases_unconsumed_idx").on(table.userId, table.createdAt)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    planKey: text("plan_key").$type<PlanKey>().notNull(),
    // Stripe's vocabulary, stored as given. An unrecognised status must land in
    // the table, not bounce the webhook into an endless retry.
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("subscriptions_user_idx").on(table.userId, table.status)],
);

/**
 * The idempotency ledger. Every webhook claims its event here before doing any
 * work, so a redelivery is a no-op rather than a second purchase.
 */
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

export const ENTITLEMENT_SCOPES = ["event", "account"] as const;
export type EntitlementScope = (typeof ENTITLEMENT_SCOPES)[number];
export const ENTITLEMENT_SOURCES = ["admin", "stripe", "promo"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];
export const ENTITLEMENT_STATUSES = ["active", "revoked"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/**
 * ACT-1: the ledger of what an account has been granted. Replaces reading the
 * plan off `users.plan_key`, which put a per-event product on the account and
 * let one $39 pass create an event every month indefinitely.
 *
 * Two shapes. A **pass** (`scope = 'event'`, Klik Event and Premium) licenses
 * exactly one event: `applied_at` marks it spent, permanently, even if that
 * event is later purged, so a pass can never come back to life. An **account
 * grant** (`scope = 'account'`, Klik Venue) licenses any number of the owner's
 * events up to limits snapshotted onto the row when it was granted, the same
 * way retention is pinned, so editing lib/plans.ts never retroactively changes
 * what someone was given.
 *
 * Rows are revoked, never deleted, so the record of a grant outlives it.
 * Constraints and the limit trigger are in drizzle/0018_entitlements.sql.
 */
export const entitlements = pgTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planKey: text("plan_key").$type<PlanKey>().notNull(),
    scope: text("scope").$type<EntitlementScope>().notNull(),
    source: text("source").$type<EntitlementSource>().notNull(),
    status: text("status").$type<EntitlementStatus>().notNull().default("active"),
    appliedEventId: text("applied_event_id").references(() => events.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxActiveEvents: integer("max_active_events"),
    maxEventsPerMonth: integer("max_events_per_month"),
    reason: text("reason"),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    grantedByLabel: text("granted_by_label"),
    stripeRef: text("stripe_ref"),
    /** PAY-5, ADM-2: what was recorded as paid, in cents. 0 a comp, null before this was kept. */
    amountCents: integer("amount_cents"),
    /** PAY-8: when a failed payment's 7-day grace began. See lib/billing-grace.ts. */
    graceStartedAt: timestamp("grace_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    revokeReason: text("revoke_reason"),
  },
  (table) => [index("entitlements_user_idx").on(table.userId, table.createdAt)],
);

export type Entitlement = typeof entitlements.$inferSelect;

export const EXPORT_STATUSES = ["building", "ready", "failed", "expired"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** One ZIP file of an export: what goes in it, and where it landed. */
export interface ExportPart {
  /** Media ids, snapshotted when the export was asked for. */
  items: string[];
  /** Set once built. Under `exports/`, never `events/`. */
  key: string | null;
  bytes: number;
  files: number;
}

/**
 * MED-7: a ZIP export built in the background by the job queue, one job per
 * part, written to `exports/<eventId>/<exportId>/part-N.zip`.
 *
 * Exports are copies, so they are short-lived by design: they expire after 7
 * days, the daily job deletes anything under `exports/` older than that whether
 * or not a row still points at it, and erasure deletes an event's exports
 * outright, because a ZIP of somebody's photos is still somebody's photos.
 */
// Named mediaExports, not exports: a module-level `exports` collides with the
// CommonJS wrapper wherever this file is compiled to CJS, as drizzle-kit does.
export const mediaExports = pgTable(
  "exports",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<ExportStatus>().notNull().default("building"),
    label: text("label").notNull(),
    partCount: integer("part_count").notNull(),
    partsDone: integer("parts_done").notNull().default(0),
    parts: jsonb("parts").$type<ExportPart[]>().notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("exports_event_idx").on(table.eventId, table.createdAt)],
);

export type MediaExport = typeof mediaExports.$inferSelect;

export const REPORT_REASONS = [
  "child_safety",
  "nudity",
  "violence",
  "harassment",
  "privacy",
  "copyright",
  "spam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** TRS-1: a guest or organizer flagging a photo. See lib/reports.ts. */
export const mediaReports = pgTable("media_reports", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  mediaId: text("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  reporterGuestId: text("reporter_guest_id").references(() => guests.id, { onDelete: "set null" }),
  reporterUserId: text("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
  reporterKey: text("reporter_key").notNull(),
  reason: text("reason").$type<ReportReason>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolution: text("resolution"),
});

export type MediaReport = typeof mediaReports.$inferSelect;

/**
 * MED-9: one heart per person per item. `reactor` is `g:<guest id>` or
 * `u:<user id>`, which a CHECK in drizzle/0030 holds to whichever id is set, so
 * one primary key covers guests and the host alike.
 */
export const mediaReactions = pgTable(
  "media_reactions",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    reactor: text("reactor").notNull(),
    guestId: text("guest_id").references(() => guests.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"heart">().notNull().default("heart"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.mediaId, table.reactor, table.kind] })],
);

export const COMMENT_HIDDEN_REASONS = ["host", "reports", "klik"] as const;
export type CommentHiddenReason = (typeof COMMENT_HIDDEN_REASONS)[number];

/** MED-9: a comment, which needs an account. See lib/comments.ts. */
export const mediaComments = pgTable("media_comments", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  mediaId: text("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenByUserId: text("hidden_by_user_id").references(() => users.id, { onDelete: "set null" }),
  hiddenReason: text("hidden_reason").$type<CommentHiddenReason>(),
});

export type MediaComment = typeof mediaComments.$inferSelect;

/** MED-9: a report on a comment. Kept apart from media_reports; see drizzle/0030. */
export const commentReports = pgTable("comment_reports", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  commentId: text("comment_id")
    .notNull()
    .references(() => mediaComments.id, { onDelete: "cascade" }),
  reporterGuestId: text("reporter_guest_id").references(() => guests.id, { onDelete: "set null" }),
  reporterUserId: text("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
  reporterKey: text("reporter_key").notNull(),
  reason: text("reason").$type<ReportReason>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolution: text("resolution"),
});

/**
 * ADM-4: an append-only record of actions that change access, money or data,
 * and who took them. Written through `recordAudit` in lib/audit.ts, which never
 * throws. Holds no personal data beyond the actor's name: targets are ids, and
 * `detail` is written by code, never copied from user input.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_created_idx").on(table.createdAt)],
);

export type AuditEntry = typeof auditLog.$inferSelect;

/**
 * ORG-3: an invitation to an event's team for an email address that may not
 * have an account yet. The token is in the email; only its hash is stored.
 */
/**
 * ID-1: a handle given up by a change, parked so nobody else takes it straight
 * away. Enforced by triggers in drizzle/0027_usernames.sql, not by app code.
 */
export const usernameReservations = pgTable("username_reservations", {
  usernameLower: text("username_lower").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
});

export const eventInvites = pgTable("event_invites", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<AssignableRole>().notNull().default("manager"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedByUserId: text("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type EventInvite = typeof eventInvites.$inferSelect;

export const JOB_STATUSES = ["queued", "running", "succeeded", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Work that outlives a request: thumbnails, transcodes, exports, reaping. See
 * `lib/jobs.ts` for how a row gets here and `lib/job-runner.ts` for how it
 * leaves.
 *
 * Postgres rather than a queue service, on purpose. The volume is small, the
 * claim is one `FOR UPDATE SKIP LOCKED` statement, and every job sits next to
 * the rows it is about, so "what happened to this upload" is one query rather
 * than a trip to a second vendor's dashboard.
 *
 * The partial indexes, including the dedupe unique index that `enqueue` relies
 * on for `ON CONFLICT`, live in drizzle/0016_jobs.sql, for the same reason the
 * media soft-delete indexes do: drizzle-kit push would recreate them as full
 * indexes.
 */
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  // Two enqueues with the same key while the first is still waiting or running
  // collapse into one. Null opts out. Uniqueness is scoped to live jobs, so a
  // finished job never blocks the next run of the same work.
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * GRW-3: a prompt the host sets for guests to take a photo of. Soft-deleted,
 * so photos taken for a removed prompt still point at it. See
 * drizzle/0034_challenges.sql and lib/challenges.ts.
 */
export const challenges = pgTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  // challenges_event_idx is partial and lives in drizzle/0034 (constraint 4).
);

export type Challenge = typeof challenges.$inferSelect;

/**
 * VEN-2: a tablet at the venue that only takes photos. Its uploads belong to
 * `guest_id`, an ordinary guest row, so they are moderated, counted and
 * erasable like any other. See drizzle/0033_kiosks.sql and lib/kiosks.ts.
 */
export const kiosks = pgTable(
  "kiosks",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    albumId: text("album_id").references(() => albums.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // A one-time code, hashed, for the tablet to pair with. Cleared on use.
    pairCodeHash: text("pair_code_hash"),
    pairExpiresAt: timestamp("pair_expires_at", { withTimezone: true }),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  // kiosks_pair_code_idx is partial and lives in drizzle/0033 (constraint 4).
  (table) => [index("kiosks_event_idx").on(table.eventId), uniqueIndex("kiosks_guest_idx").on(table.guestId)],
);

/**
 * QR-4: print designs. `doc` is the scene the studio draws (lib/print/doc.ts),
 * carrying its own schema version; `revision` counts saves so a stale copy
 * cannot overwrite a newer one.
 */
export const printDesigns = pgTable(
  "print_designs",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    preset: text("preset").notNull(),
    widthMm: real("width_mm").notNull(),
    heightMm: real("height_mm").notNull(),
    bleedMm: real("bleed_mm").notNull().default(3),
    doc: jsonb("doc").$type<unknown>().notNull(),
    revision: integer("revision").notNull().default(1),
    thumbnailKey: text("thumbnail_key"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("print_designs_event_idx").on(table.eventId, table.updatedAt)],
);

/** The last ten earlier states of a design. */
export const printDesignVersions = pgTable(
  "print_design_versions",
  {
    id: text("id").primaryKey(),
    designId: text("design_id")
      .notNull()
      .references(() => printDesigns.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    doc: jsonb("doc").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("print_design_versions_design_idx").on(table.designId, table.createdAt)],
);

/** Photos and logos uploaded for designs, under `designs/<eventId>/`. */
export const printAssets = pgTable(
  "print_assets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("print_assets_event_idx").on(table.eventId, table.createdAt)],
);

export type PrintDesign = typeof printDesigns.$inferSelect;
export type PrintAsset = typeof printAssets.$inferSelect;
export type Kiosk = typeof kiosks.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Guest = typeof guests.$inferSelect;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type EventCoHost = typeof eventCoHosts.$inferSelect;
export type VenueClient = typeof venueClients.$inferSelect;
export type MediaShare = typeof mediaShares.$inferSelect;
export type NewMediaShare = typeof mediaShares.$inferInsert;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
