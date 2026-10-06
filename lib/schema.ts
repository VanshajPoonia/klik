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
  primaryKey,
} from "drizzle-orm/pg-core";
import type { PlanKey } from "./plans";

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
  planKey: text("plan_key").$type<PlanKey>().notNull().default("event"),
  venueSlug: text("venue_slug").unique(),
  credentialVersion: integer("credential_version").notNull().default(0),
  username: text("username").unique(), // set only for credential-based accounts
  passwordHash: text("password_hash"), // bcrypt, set only alongside username
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
});

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

export const SHARE_SCOPES = ["media", "album", "event"] as const;
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
  },
  (table) => [index("events_owner_idx").on(table.ownerId)],
);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
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
    // Soft delete. A deleted photo is irreplaceable and the storage to keep it
    // for 30 days is not, so every read path filters on this rather than the
    // row being gone. See ROADMAP.md SEC-4.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
