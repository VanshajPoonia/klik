import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  EVENT_ROLES,
  can,
  capabilitiesFor,
  isAssignableRole,
  ROLE_LABELS,
  type EventCapability,
  type EventRole,
} from "./permissions";

/**
 * Every capability in the system. Kept here rather than exported from the
 * module so that adding one there and forgetting it here fails the exhaustive
 * check below, instead of quietly going untested.
 */
const ALL_CAPABILITIES: EventCapability[] = [
  "event.settings",
  "event.qr",
  "event.delete",
  "event.transfer",
  "cohosts.manage",
  "media.moderate",
  "media.delete",
  "media.upload",
  "media.viewPrivate",
  "albums.manage",
  "media.exportAll",
  "trash.manage",
];

/**
 * The matrix, written out independently of the implementation.
 *
 * This is duplication on purpose. A test that imports the same table it is
 * checking proves only that an array equals itself. Spelled out separately,
 * changing a permission means changing it in two places, which is exactly the
 * friction an authorization table should have.
 */
const EXPECTED: Record<EventRole, Record<EventCapability, boolean>> = {
  owner: {
    "event.settings": true,
    "event.qr": true,
    "event.delete": true,
    "event.transfer": true,
    "cohosts.manage": true,
    "media.moderate": true,
    "media.delete": true,
    "media.upload": true,
    "media.viewPrivate": true,
    "albums.manage": true,
    "media.exportAll": true,
    "trash.manage": true,
  },
  manager: {
    "event.settings": true,
    "event.qr": true,
    // A manager runs the event; they do not get to end it or hand it over.
    "event.delete": false,
    "event.transfer": false,
    "cohosts.manage": true,
    "media.moderate": true,
    "media.delete": true,
    "media.upload": true,
    "media.viewPrivate": true,
    "albums.manage": true,
    "media.exportAll": true,
    "trash.manage": true,
  },
  moderator: {
    // Runs the gallery, does not configure it. Crucially cannot manage
    // co-hosts, so a moderator cannot promote themselves.
    "event.settings": false,
    "event.qr": false,
    "event.delete": false,
    "event.transfer": false,
    "cohosts.manage": false,
    "media.moderate": true,
    "media.delete": true,
    "media.upload": true,
    "media.viewPrivate": true,
    "albums.manage": true,
    "media.exportAll": false,
    "trash.manage": true,
  },
  contributor: {
    // The hired-photographer role. Puts photos in, sees what is there.
    "event.settings": false,
    "event.qr": false,
    "event.delete": false,
    "event.transfer": false,
    "cohosts.manage": false,
    "media.moderate": false,
    // Cannot delete: the person shooting the event is not the person who
    // should be able to remove a guest's photo of it.
    "media.delete": false,
    "media.upload": true,
    "media.viewPrivate": true,
    "albums.manage": false,
    "media.exportAll": false,
    "trash.manage": false,
  },
};

describe("the permission matrix", () => {
  for (const role of EVENT_ROLES) {
    describe(role, () => {
      for (const capability of ALL_CAPABILITIES) {
        const expected = EXPECTED[role][capability];
        it(`${expected ? "grants" : "denies"} ${capability}`, () => {
          expect(can(role, capability)).toBe(expected);
        });
      }
    });
  }

  it("covers every capability the module actually defines", () => {
    const declared = new Set(EVENT_ROLES.flatMap((role) => capabilitiesFor(role)));
    const tested = new Set(ALL_CAPABILITIES);
    const untested = [...declared].filter((capability) => !tested.has(capability));
    expect(
      untested,
      `Capabilities granted somewhere in the matrix but not listed in this test: ${untested.join(", ")}`,
    ).toEqual([]);
  });
});

describe("escalation", () => {
  /**
   * The property that matters more than any single cell: nobody below manager
   * can hand themselves more access. If this fails, a moderator can add
   * themselves as a manager and the whole table is decorative.
   */
  it("stops anyone below manager from changing the team", () => {
    expect(can("moderator", "cohosts.manage")).toBe(false);
    expect(can("contributor", "cohosts.manage")).toBe(false);
  });

  it("stops anyone but the owner ending or transferring the event", () => {
    for (const role of ["manager", "moderator", "contributor"] as const) {
      expect(can(role, "event.delete"), role).toBe(false);
      expect(can(role, "event.transfer"), role).toBe(false);
    }
  });

  it("gives every role strictly less than the one above it", () => {
    const ladder: EventRole[] = ["owner", "manager", "moderator", "contributor"];
    for (let i = 1; i < ladder.length; i += 1) {
      const wider = new Set(capabilitiesFor(ladder[i - 1]));
      const narrower = capabilitiesFor(ladder[i]);
      const extra = narrower.filter((capability) => !wider.has(capability));
      expect(extra, `${ladder[i]} holds something ${ladder[i - 1]} does not`).toEqual([]);
      expect(narrower.length).toBeLessThan(wider.size);
    }
  });
});

describe("isAssignableRole", () => {
  it("accepts the three assignable roles", () => {
    for (const role of ASSIGNABLE_ROLES) expect(isAssignableRole(role)).toBe(true);
  });

  it("rejects owner, which is derived from events.owner_id and never stored", () => {
    expect(isAssignableRole("owner")).toBe(false);
  });

  it("rejects anything else, including the shapes that arrive over the wire", () => {
    for (const value of ["", "admin", "MANAGER", null, undefined, 1, {}, []]) {
      expect(isAssignableRole(value)).toBe(false);
    }
  });
});

describe("ROLE_LABELS", () => {
  it("describes every assignable role, so the UI never renders a raw key", () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(ROLE_LABELS[role]?.label, role).toBeTruthy();
      expect(ROLE_LABELS[role]?.description, role).toBeTruthy();
    }
  });
});
