import { describe, expect, it } from "vitest";
import { eventLicenseState, eventPlan, isGrantCurrent, scopeForPlan, windowStart } from "./license";
import { canUpload, canViewGallery, isExpired } from "./access";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function event(overrides: Partial<Parameters<typeof canUpload>[0] & Parameters<typeof canViewGallery>[0]> = {}) {
  return {
    visibility: "public" as const,
    expiresAt: null,
    createdAt: ago(1),
    licensedAt: ago(1),
    entitlementId: "ent_1",
    planKey: "event" as const,
    isActive: true,
    uploadsEnabled: true,
    ...overrides,
  };
}

describe("eventLicenseState", () => {
  it("is live while something licenses it", () => {
    expect(eventLicenseState({ entitlementId: "ent_1", licensedAt: ago(1) })).toBe("live");
  });
  it("is a draft until it has ever gone live", () => {
    expect(eventLicenseState({ entitlementId: null, licensedAt: null })).toBe("draft");
  });
  it("is lapsed once its licence is taken away, never back to a draft", () => {
    expect(eventLicenseState({ entitlementId: null, licensedAt: ago(10) })).toBe("lapsed");
  });
});

describe("the rest of the pure rules", () => {
  it("passes for Event and Premium, an account grant for Venue", () => {
    expect(scopeForPlan("event")).toBe("event");
    expect(scopeForPlan("premium")).toBe("event");
    expect(scopeForPlan("venue")).toBe("account");
  });

  it("governs a draft by the most restrictive plan, never by a default that grants more", () => {
    expect(eventPlan({ planKey: null }).key).toBe("event");
  });

  it("counts windows from going live, not from when the draft was made", () => {
    const createdAt = ago(200);
    const licensedAt = ago(2);
    expect(windowStart({ createdAt, licensedAt })).toBe(licensedAt);
  });

  it("treats a grant as current only between its start and end, while active", () => {
    const base = { status: "active" as const, startsAt: ago(5), endsAt: null };
    expect(isGrantCurrent(base)).toBe(true);
    expect(isGrantCurrent({ ...base, endsAt: ago(1) })).toBe(false);
    expect(isGrantCurrent({ ...base, startsAt: new Date(Date.now() + DAY) })).toBe(false);
    expect(isGrantCurrent({ ...base, status: "revoked" })).toBe(false);
  });
});

describe("access, given licensing", () => {
  it("keeps a draft from every guest and lets its team in", () => {
    const draft = event({ entitlementId: null, licensedAt: null });
    expect(canViewGallery(draft, { isOwner: false, hasUnlockCookie: false })).toEqual({
      allowed: false,
      reason: "not_open",
    });
    expect(canViewGallery(draft, { isOwner: true, hasUnlockCookie: false })).toEqual({ allowed: true });
  });

  it("never takes uploads into a draft or a lapsed event", () => {
    expect(canUpload(event({ entitlementId: null, licensedAt: null }))).toBe(false);
    expect(canUpload(event({ entitlementId: null }))).toBe(false);
    expect(canUpload(event())).toBe(true);
  });

  it("keeps a lapsed gallery viewable, because guests did nothing wrong", () => {
    expect(canViewGallery(event({ entitlementId: null }), { isOwner: false, hasUnlockCookie: false })).toEqual({
      allowed: true,
    });
  });

  /**
   * The bug this column fixes. A draft made 200 days before the wedding used to
   * have its 30-day upload window and 180-day gallery counted from creation, so
   * it arrived at the event already closed.
   */
  it("opens uploads for a draft made long ago that has only just gone live", () => {
    const longPlanned = event({ createdAt: ago(200), licensedAt: ago(1) });
    expect(isExpired(longPlanned)).toBe(false);
    expect(canUpload(longPlanned)).toBe(true);
  });

  it("closes uploads when the plan's window from going live has passed", () => {
    expect(canUpload(event({ licensedAt: ago(31), createdAt: ago(31) }))).toBe(false);
    expect(canUpload(event({ planKey: "premium", licensedAt: ago(31), createdAt: ago(31) }))).toBe(true);
  });
});
