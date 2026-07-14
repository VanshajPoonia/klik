import { nanoid, customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { events, type Event, type EventVisibility } from "./schema";

const slugSuffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);

// Gallery passwords are shared with party guests, not account credentials -
// cost 10 per ARCHITECTURE.md §8's documented security checklist.
const GALLERY_PASSWORD_COST = 10;

function hashGalleryPassword(password: string): Promise<string> {
  return bcrypt.hash(password, GALLERY_PASSWORD_COST);
}

export function slugifyEventName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "event";
}

export interface CreateEventInput {
  ownerId: string;
  name: string;
  eventDate?: Date | null;
  visibility?: EventVisibility;
  password?: string | null;
  moderation?: boolean;
  expiresAt?: Date | null;
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

  const query = db
    .insert(events)
    .values({
      id,
      ownerId: input.ownerId,
      slug,
      name: input.name,
      eventDate: input.eventDate ?? null,
      visibility: input.visibility ?? "public",
      passwordHash,
      moderation: input.moderation ?? false,
      expiresAt: input.expiresAt ?? null,
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

/** Strips password_hash before an event row ever reaches an API response. */
export function toPublicEvent(event: Event) {
  const { passwordHash: _passwordHash, ...rest } = event;
  return rest;
}

export type PublicEvent = ReturnType<typeof toPublicEvent>;
