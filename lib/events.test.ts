import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { events } from "./schema";
import { slugifyEventName, toOrganizerEvent, toPublicEvent } from "./events";
import type { Event } from "./schema";

/**
 * A fully populated row, so a test about what is *omitted* cannot pass just
 * because a field happened to be undefined. Every value here is deliberately
 * recognisable in a failure message.
 */
const row: Event = {
  id: "evt_123",
  ownerId: "usr_owner",
  slug: "summer-wedding",
  name: "Summer Wedding",
  eventDate: new Date("2026-07-04T00:00:00Z"),
  clientName: "A Client",
  clientEmail: "client@example.com",
  clientPhone: "+15550000000",
  clientId: "cli_1",
  coverMediaId: "med_1",
  accentColor: "#ffffff",
  backgroundColor: "#000000",
  qrTemplate: "classic",
  venueFeatured: true,
  visibility: "password",
  passwordHash: "$2b$10$notarealhash",
  accessVersion: 3,
  moderation: true,
  uploaderSeesOwnPrivate: true,
  isActive: true,
  downloadsEnabled: true,
  uploadsEnabled: true,
  expiresAt: new Date("2026-08-04T00:00:00Z"),
  retentionUntil: new Date("2027-07-04T00:00:00Z"),
  purgedAt: null,
  deletedAt: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  mediaChangedAt: new Date("2026-07-01T00:00:00Z"),
  entitlementId: "ent_1",
  planKey: "premium",
  licensedAt: new Date("2026-07-01T00:00:00Z"),
  activationRequestedAt: null,
  mediaCount: 12,
  mediaBytes: 1024,
  usageWarnedPercent: 0,
  retentionWarnedDays: null,
  disposableMode: false,
  shotsPerGuest: 24,
  developsAt: null,
  galleryOpens: 0,
  transferToUserId: null,
  transferOfferedAt: null,
  reactionsEnabled: true,
  commentsEnabled: true,
  momentsEnabled: true,
  leaderboardEnabled: false,
  showOnProfile: false,
  guestLanguage: "auto",
  keepPhotoDetails: false,
};

/**
 * Columns a guest is allowed to see. Mirrors `toPublicEvent` on purpose: if
 * the two drift, the test below says which way.
 */
const PUBLISHED = [
  "id",
  "slug",
  "name",
  "eventDate",
  "coverMediaId",
  "accentColor",
  "backgroundColor",
  "qrTemplate",
  "visibility",
  "moderation",
  "isActive",
  "downloadsEnabled",
  "uploadsEnabled",
  "reactionsEnabled",
  "commentsEnabled",
  "expiresAt",
  "createdAt",
] as const;

/**
 * Columns a guest must never see, each with the reason, because "why is this
 * not public" is the question someone will actually have when this fails.
 */
const WITHHELD: Record<string, string> = {
  ownerId: "internal user id, enumerable",
  clientName: "the organizer's customer, not the guest's business",
  clientEmail: "third-party personal data",
  clientPhone: "third-party personal data",
  clientId: "internal venue-client id",
  venueFeatured: "a venue's commercial arrangement",
  passwordHash: "a bcrypt hash of the gallery password",
  accessVersion: "revocation counter, leaks how often access was reset",
  retentionUntil: "internal retention schedule (SEC-1)",
  purgedAt: "internal deletion bookkeeping",
  deletedAt: "internal soft-delete state",
  updatedAt: "reveals organizer activity to guests",
  mediaChangedAt: "sync bookkeeping, read by the changes endpoint and never sent",
  // ACT-1. Whether and how an event is paid for is between the organizer and
  // Klik. A guest never sees a plan name (ROADMAP.md C-1), and the server
  // already decides everything these columns imply.
  entitlementId: "internal ledger id",
  planKey: "what the organizer bought, never shown to guests",
  licensedAt: "billing state, enforced server side",
  activationRequestedAt: "the organizer's conversation with Klik",
  mediaCount: "the server enforces capacity; guests see their own count of what is shown",
  mediaBytes: "storage use is the organizer's business, not the guests'",
  usageWarnedPercent: "notification bookkeeping",
  retentionWarnedDays: "notification bookkeeping",
  // CAM-4. Guests are told about the roll by the page, as copy, not as fields.
  disposableMode: "rendered as copy on the guest page, not sent raw",
  shotsPerGuest: "rendered as copy on the guest page, not sent raw",
  developsAt: "rendered as copy on the guest page, not sent raw",
  galleryOpens: "the host's analytics, not the guests' business",
  transferToUserId: "an internal user id, and a private arrangement",
  transferOfferedAt: "a private arrangement between organizers",
  // Host configuration. The server already filters private media out of a
  // guest's gallery, so the flag buys a guest nothing and telling them about a
  // back room they cannot see is worse than silence.
  uploaderSeesOwnPrivate: "host configuration, enforced server side",
  // AI-1. The server sends no moments when it is off, so the flag says nothing
  // a guest can use.
  momentsEnabled: "decides what the server sends, never needed raw",
  // GRW-3. The server sends no leaderboard when it is off, for the same reason.
  leaderboardEnabled: "decides what the server sends, never needed raw",
  // GRW-4. The host's choice about their own profile page.
  showOnProfile: "host configuration for their public profile",
  // TRS-3. The server picks the language and sends the words, not the setting.
  guestLanguage: "decides what the server sends, never needed raw",
  // MED-8. Applies to the team's own uploads; guests are never told.
  keepPhotoDetails: "host configuration for the team's uploads",
};

describe("toPublicEvent", () => {
  it("publishes exactly the allowlist", () => {
    expect(Object.keys(toPublicEvent(row)).sort()).toEqual([...PUBLISHED].sort());
  });

  it("withholds every private field", () => {
    const published = toPublicEvent(row) as Record<string, unknown>;
    for (const [field, reason] of Object.entries(WITHHELD)) {
      expect(published, `${field} must stay private: ${reason}`).not.toHaveProperty(field);
    }
  });

  /**
   * The actual SEC-10 guard, and the reason this file exists.
   *
   * `toPublicEvent` used to strip known-private fields and spread the rest, so
   * every new column was published to guests by default. That had already
   * failed silently: `retentionUntil`, `deletedAt` and `purgedAt` were all
   * going out. Converting it to an allowlist fixed the instance. This fixes
   * the class, by refusing to let a new column exist without someone deciding
   * which side of the line it belongs on.
   */
  it("leaves no column unclassified, so a new one cannot default to public", () => {
    const columns = Object.keys(getTableColumns(events));
    const classified = new Set<string>([...PUBLISHED, ...Object.keys(WITHHELD)]);
    const unclassified = columns.filter((column) => !classified.has(column));

    expect(
      unclassified,
      `New column(s) on "events" with no disclosure decision: ${unclassified.join(", ")}. ` +
        "Add each to PUBLISHED (and to toPublicEvent) or to WITHHELD with a reason. " +
        "Do not delete this assertion: it is SEC-10.",
    ).toEqual([]);
  });
});

describe("toOrganizerEvent", () => {
  it("keeps operational fields but never the password hash", () => {
    const organizer = toOrganizerEvent(row) as Record<string, unknown>;
    expect(organizer).not.toHaveProperty("passwordHash");
    // An organizer legitimately needs these; a guest does not.
    expect(organizer).toHaveProperty("retentionUntil");
    expect(organizer).toHaveProperty("clientEmail");
  });
});

describe("slugifyEventName", () => {
  it.each([
    ["Summer Wedding", "summer-wedding"],
    ["  Leading and trailing  ", "leading-and-trailing"],
    ["Symbols !@#$ removed", "symbols-removed"],
    ["multiple---dashes", "multiple-dashes"],
  ])("turns %j into %j", (input, expected) => {
    expect(slugifyEventName(input)).toBe(expected);
  });

  // Found by this test: the ASCII filter used to delete accented characters
  // outright rather than fold them, so these produced "caf-mnch" and "rene-s".
  // The slug is the gallery URL and it goes on a printed QR sign.
  it.each([
    ["Café Münch", "cafe-munch"],
    ["Renée's Party", "renee-s-party"],
    ["Ünïcödé Ñames", "unicode-names"],
    ["Zoë & José", "zoe-jose"],
  ])("folds accents instead of dropping them: %j to %j", (input, expected) => {
    expect(slugifyEventName(input)).toBe(expected);
  });

  it("falls back to a usable slug when a name leaves nothing behind", () => {
    // Non-Latin scripts do not transliterate here. The caller appends a random
    // suffix, so the result is still unique, just not meaningful.
    for (const input of ["---", "!!!", "?", "\u0938\u0917\u093e\u0908"]) {
      expect(slugifyEventName(input), input).toBe("event");
    }
  });

  it("never produces a slug that starts or ends with a dash", () => {
    // Includes a name long enough that the 40-character truncation lands on a
    // separator, which is the case that produced a trailing dash.
    for (const input of ["---", "!!!", " - hello - ", "?", "a".repeat(39) + " tail"]) {
      const slug = slugifyEventName(input);
      expect(slug.startsWith("-"), input).toBe(false);
      expect(slug.endsWith("-"), input).toBe(false);
    }
  });
});
