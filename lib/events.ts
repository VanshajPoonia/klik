import { nanoid, customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { events, type Event, type EventVisibility } from "./schema";
import { PLANS, getPlanDeadline } from "./plans";

const slugSuffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);

// Gallery passwords are shared with party guests, not account credentials, so
// cost 10 per ARCHITECTURE.md §8's documented security checklist.
const GALLERY_PASSWORD_COST = 10;

function hashGalleryPassword(password: string): Promise<string> {
  return bcrypt.hash(password, GALLERY_PASSWORD_COST);
}

export function slugifyEventName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    // Split accented characters into a base letter plus a combining mark, then
    // drop the marks. Without this the ASCII filter below deletes the whole
    // character, so "Café Münch" became "caf-mnch" and "Renée" became "rene".
    // The slug is the organizer-facing gallery URL and goes on a printed QR
    // sign, so a mangled one is visible in exactly the wrong place.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // Truncating to 40 can land mid-separator and leave a trailing dash.
    .replace(/-+$/g, "");
  // A name written entirely in a non-Latin script leaves nothing behind. The
  // caller appends a random suffix, so "event-k3m9dx" is still unique and
  // still works; it just carries no meaning. Better than an empty slug.
  return base || "event";
}

export interface CreateEventInput {
  ownerId: string;
  name: string;
  eventDate?: Date | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientId?: string | null;
  visibility?: EventVisibility;
  password?: string | null;
  moderation?: boolean;
  expiresAt?: Date | null;
  /**
   * Gallery retention for this event, in days, taken from the owner's plan at
   * creation. Passed in rather than looked up because admin quick-create
   * inserts the owner and the event in one batch, so the user row does not
   * exist yet when this runs.
   */
  retentionDays?: number;
}

/**
 * Builds (but does not execute) the event insert. Lets callers that need
 * atomicity with another insert (e.g. admin quick-create, which also inserts
 * a users row) compose both into a single db.batch([...]) - neon-http has no
 * db.transaction() support, only db.batch().
 */
export async function prepareEventInsert(input: CreateEventInput) {
  const slug = `${slugifyEventName(input.name)}-${slugSuffix()}`;
  const passwordHash = input.password ? await hashGalleryPassword(input.password) : null;
  const id = nanoid();
  // Pinned from this moment rather than read back from created_at later, so the
  // stored deadline and the row's own timestamp cannot drift apart.
  const createdAt = new Date();

  const query = db
    .insert(events)
    .values({
      id,
      ownerId: input.ownerId,
      slug,
      name: input.name,
      eventDate: input.eventDate ?? null,
      clientName: input.clientName ?? null,
      clientEmail: input.clientEmail ?? null,
      clientPhone: input.clientPhone ?? null,
      clientId: input.clientId ?? null,
      createdAt,
      visibility: input.visibility ?? "public",
      passwordHash,
      moderation: input.moderation ?? false,
      expiresAt: input.expiresAt ?? null,
      retentionUntil: getPlanDeadline(
        createdAt,
        input.retentionDays ?? PLANS.event.galleryAccessDays,
      ),
    })
    .returning();

  return { query, id, slug };
}

export async function createEvent(input: CreateEventInput) {
  const { query } = await prepareEventInsert(input);
  const [event] = await query;
  return event;
}

export { hashGalleryPassword };

/** Owner-safe event shape that keeps operational fields but never exposes a password hash. */
export function toOrganizerEvent(event: Event) {
  const { passwordHash, ...rest } = event;
  void passwordHash;
  return rest;
}

/**
 * Guest-safe event shape.
 *
 * This is an **allowlist**, deliberately. It used to strip known-private fields
 * and spread the rest, which meant every column added to `events` was published
 * to guests by default and only became private if someone remembered to exclude
 * it. That failed open, and it had already failed: `retentionUntil`,
 * `deletedAt` and `purgedAt` were all being handed to guests.
 *
 * Adding a field here is a conscious act. Forgetting to add one shows up as a
 * missing value in the gallery, which is a bug you notice, rather than as a
 * silent disclosure, which is a bug you do not.
 */
export function toPublicEvent(event: Event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    eventDate: event.eventDate,
    coverMediaId: event.coverMediaId,
    accentColor: event.accentColor,
    backgroundColor: event.backgroundColor,
    qrTemplate: event.qrTemplate,
    visibility: event.visibility,
    moderation: event.moderation,
    isActive: event.isActive,
    downloadsEnabled: event.downloadsEnabled,
    uploadsEnabled: event.uploadsEnabled,
    expiresAt: event.expiresAt,
    createdAt: event.createdAt,
  };
}

export type OrganizerEvent = ReturnType<typeof toOrganizerEvent>;
export type PublicEvent = ReturnType<typeof toPublicEvent>;
