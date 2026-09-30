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
    accessVersion: integer("access_version").notNull().default(0),
    moderation: boolean("moderation").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    downloadsEnabled: boolean("downloads_enabled").notNull().default(true),
    uploadsEnabled: boolean("uploads_enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
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
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    contentHash: text("content_hash"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationS: real("duration_s"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_event_status_created_idx").on(table.eventId, table.status, table.createdAt),
    index("media_event_hash_idx").on(table.eventId, table.contentHash),
  ],
);

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
