/**
 * Who can do what on an event. One table, read by everything.
 *
 * Before this, "can this person manage the event" was a single boolean:
 * `requireEventManagerSession` returned a session or null, and every co-host
 * therefore had the owner's powers short of owning the row. A hired
 * photographer added so they could upload could also rotate the QR code,
 * change the gallery password and remove the other co-hosts.
 *
 * The matrix lives here rather than in the routes because the failure mode of
 * scattering it is silent: a new route that forgets a check does not break, it
 * just quietly allows everyone. A capability that is missing from this table is
 * a type error; a capability that is never checked is at least greppable.
 */

/**
 * `owner` is not stored in `event_co_hosts`. It is derived from
 * `events.owner_id`, and it exists here only so the matrix can answer for
 * every actor rather than making callers special-case the owner.
 */
export const EVENT_ROLES = ["owner", "manager", "moderator", "contributor"] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

/** The roles that can actually be assigned to a co-host. */
export const ASSIGNABLE_ROLES = ["manager", "moderator", "contributor"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const DEFAULT_CO_HOST_ROLE: AssignableRole = "manager";

export type EventCapability =
  /** Rename, change visibility or password, toggle uploads and downloads. */
  | "event.settings"
  /** Rotate the slug, restyle or regenerate the QR and printed sign. */
  | "event.qr"
  /** Soft-delete the event itself, and restore it. */
  | "event.delete"
  /** Hand the event to someone else. Owner only, by definition. */
  | "event.transfer"
  /** Add, remove, or change the role of a co-host. */
  | "cohosts.manage"
  /**
   * Create, edit and revoke share links. Grouped with the access-granting
   * capabilities rather than the media ones on purpose: a share link is not a
   * way of organising photos, it is a way of handing one to someone outside the
   * event entirely, and it outlives the moment it was created.
   */
  | "shares.manage"
  /** Approve and reject in the moderation queue. */
  | "media.moderate"
  /** Remove a guest's upload. */
  | "media.delete"
  /** Upload into the gallery as the event rather than as a guest. */
  | "media.upload"
  /** See pending and private media that guests cannot. */
  | "media.viewPrivate"
  /** Create, rename and delete albums. */
  | "albums.manage"
  /** Download-all ZIP of the whole gallery. */
  | "media.exportAll"
  /** View the trash and restore from it. */
  | "trash.manage";

/**
 * Deliberately written out per role rather than composed by spreading a
 * narrower role into a wider one. Spreading reads nicely and hides exactly the
 * thing worth seeing: when a capability is added, this layout forces a decision
 * on every row instead of silently granting it to whoever inherits.
 */
const MATRIX: Record<EventRole, readonly EventCapability[]> = {
  owner: [
    "event.settings",
    "event.qr",
    "event.delete",
    "event.transfer",
    "cohosts.manage",
    "shares.manage",
    "media.moderate",
    "media.delete",
    "media.upload",
    "media.viewPrivate",
    "albums.manage",
    "media.exportAll",
    "trash.manage",
  ],
  // Everything except billing, deleting the event, and handing it to someone
  // else. A manager runs the event; they do not get to end it.
  manager: [
    "event.settings",
    "event.qr",
    "cohosts.manage",
    "shares.manage",
    "media.moderate",
    "media.delete",
    "media.upload",
    "media.viewPrivate",
    "albums.manage",
    "media.exportAll",
    "trash.manage",
  ],
  // Runs the gallery, does not configure it. No settings, no QR rotation, no
  // co-host changes, so a moderator cannot widen their own access. No share
  // links either, for the same reason: a link is access granted to a stranger,
  // and a role that cannot add a co-host should not be able to route around that
  // by sending the photo out directly.
  moderator: [
    "media.moderate",
    "media.delete",
    "media.upload",
    "media.viewPrivate",
    "albums.manage",
    "trash.manage",
  ],
  // The hired-photographer role. Puts photos in, sees what is there, nothing
  // else. Notably cannot delete, because the person shooting the event is not
  // the person who should be able to remove a guest's photo of it.
  contributor: ["media.upload", "media.viewPrivate"],
};

export function can(role: EventRole, capability: EventCapability): boolean {
  return MATRIX[role]?.includes(capability) ?? false;
}

/** Every capability a role holds. For rendering a UI without guessing. */
export function capabilitiesFor(role: EventRole): readonly EventCapability[] {
  return MATRIX[role] ?? [];
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<AssignableRole, { label: string; description: string }> = {
  manager: {
    label: "Manager",
    description: "Runs the event. Everything except deleting it or handing it over.",
  },
  moderator: {
    label: "Moderator",
    description: "Approves, removes and organises photos. Cannot change settings.",
  },
  contributor: {
    label: "Contributor",
    description: "Uploads and views. For a hired photographer.",
  },
};
