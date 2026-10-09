/**
 * The facts both legal pages state, in one place.
 *
 * These numbers are promises. Each one is also enforced somewhere in the code,
 * and the pair has to stay true together: if `TRASH_RETENTION_DAYS` in the
 * purge cron changes and this file does not, the policy becomes a false
 * statement about how the product behaves, which is worse than a vague one.
 * The comment on each constant names what enforces it.
 */

/**
 * The operating entity.
 *
 * **This must match the registered legal name exactly.** It is the name a
 * customer would have to sue, and the one the DMCA designation is filed under.
 */
export const LEGAL_ENTITY = "Kreativ Vantage";
export const SERVICE_NAME = "Klik";

/** Bump whenever either page changes in substance, not for typos. */
export const LEGAL_LAST_UPDATED = "10 October 2026";

/** Where notices go. Routed to a human; there is no inbox behind no-reply. */
export const LEGAL_CONTACT_EMAIL = "hello@klik.kreativvantage.com";

/** Enforced by `TRASH_RETENTION_DAYS` in `app/api/cron/purge-expired/route.ts`. */
export const SOFT_DELETE_DAYS = 30;

/**
 * Enforced by the Bucket Lock and lifecycle rule on `klik-media-backup`, set
 * 2026-10-08. The lock holds objects for 30 days and the lifecycle removes them
 * at 31, so 31 is the honest outer bound to state.
 */
export const BACKUP_EXPIRY_DAYS = 31;

/** From `galleryAccessDays` in `lib/plans.ts`. */
export const GALLERY_ACCESS_DAYS = { event: 180, premium: 365, venue: 365 } as const;

/** Enforced by `pruneRateLimits` in `lib/ratelimit.ts`, called by the nightly purge. */
export const RATE_LIMIT_RETENTION_HOURS = 24;

/** `maxAge` on the guest and event-unlock cookies in the session route. */
export const COOKIE_DAYS = 30;
