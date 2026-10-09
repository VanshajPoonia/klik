import { describe, expect, it } from "vitest";
import {
  DENIAL_COPY,
  denialCopy,
  denialStatus,
  isCollectionScope,
  shareZipFilename,
  evaluateShare,
  EXPIRY_OPTIONS,
  MAX_SHARE_VIEWS,
  VIEW_LIMIT_OPTIONS,
  type ShareDenial,
  type ShareGateFields,
} from "./share-access";
import { generateShareToken, hashSharePassword, toManagedShare, verifySharePassword } from "./shares";
import type { Media, MediaShare } from "./schema";

const NOW = new Date("2026-10-03T12:00:00Z");

function share(overrides: Partial<ShareGateFields> = {}): ShareGateFields {
  return {
    revokedAt: null,
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    passwordHash: null,
    ...overrides,
  };
}

/** A browser that has entered nothing and spent nothing: the first visit. */
const OPEN = { unlocked: false, counted: false };
const UNLOCKED = { unlocked: true, counted: false };
/** A browser that already spent one of this link's views. */
const COUNTED = { unlocked: false, counted: true };

describe("the share gate", () => {
  it("opens a plain link", () => {
    expect(evaluateShare(share(), OPEN, NOW)).toEqual({ ok: true });
  });

  describe("revocation", () => {
    it("closes the link", () => {
      expect(evaluateShare(share({ revokedAt: new Date("2026-10-01") }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "revoked",
      });
    });

    /**
     * The ordering that matters. A host revokes a link because they want it shut
     * now; if a password prompt came first, the person holding the link would be
     * asked for a password, enter the right one, and only then be told no. Worse,
     * any bug in the password branch would be sitting in front of the one control
     * a host has left once a link has escaped.
     */
    it("beats every other condition, including a correct password", () => {
      const beaten = share({
        revokedAt: new Date("2026-10-01"),
        expiresAt: new Date("2026-09-01"),
        maxViews: 1,
        viewCount: 99,
        passwordHash: "whatever",
      });
      expect(evaluateShare(beaten, UNLOCKED, NOW)).toEqual({ ok: false, reason: "revoked" });
    });
  });

  describe("expiry", () => {
    it("closes once the moment has passed", () => {
      expect(
        evaluateShare(share({ expiresAt: new Date("2026-10-03T11:59:59Z") }), OPEN, NOW),
      ).toEqual({ ok: false, reason: "expired" });
    });

    it("stays open before it", () => {
      expect(
        evaluateShare(share({ expiresAt: new Date("2026-10-03T12:00:01Z") }), OPEN, NOW),
      ).toEqual({ ok: true });
    });

    /** Exactly at the boundary is closed, so "expires at midnight" means it does
     *  not work at midnight rather than working for one more millisecond. */
    it("is closed at the exact instant it expires", () => {
      expect(evaluateShare(share({ expiresAt: NOW }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });

  describe("the view cap", () => {
    it("stays open below the cap", () => {
      expect(evaluateShare(share({ maxViews: 3, viewCount: 2 }), OPEN, NOW)).toEqual({ ok: true });
    });

    it("closes on reaching it", () => {
      expect(evaluateShare(share({ maxViews: 3, viewCount: 3 }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "exhausted",
      });
    });

    /** A count that somehow ran past the cap is still closed, not reopened by an
     *  off-by-one. */
    it("closes past it", () => {
      expect(evaluateShare(share({ maxViews: 3, viewCount: 40 }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "exhausted",
      });
    });

    /**
     * The cap counts viewers, not page loads. Without this, opening a one-view
     * link and then rotating your phone locks you out of the photo you are
     * looking at.
     */
    it("still opens for the viewer who spent the last view", () => {
      expect(evaluateShare(share({ maxViews: 1, viewCount: 1 }), COUNTED, NOW)).toEqual({
        ok: true,
      });
    });

    it("does not let a counted viewer past expiry", () => {
      expect(
        evaluateShare(
          share({ maxViews: 1, viewCount: 1, expiresAt: new Date("2026-01-01") }),
          COUNTED,
          NOW,
        ),
      ).toEqual({ ok: false, reason: "expired" });
    });

    it("does not let a counted viewer past revocation", () => {
      expect(
        evaluateShare(
          share({ maxViews: 1, viewCount: 1, revokedAt: new Date("2026-10-02") }),
          COUNTED,
          NOW,
        ),
      ).toEqual({ ok: false, reason: "revoked" });
    });

    /** Being counted is not being unlocked. They are separate flags on the same
     *  cookie and conflating them would hand out the password for free. */
    it("still asks a counted viewer for the password", () => {
      expect(
        evaluateShare(share({ maxViews: 1, viewCount: 1, passwordHash: "hash" }), COUNTED, NOW),
      ).toEqual({ ok: false, reason: "password" });
    });

    it("ignores the count entirely when there is no cap", () => {
      expect(evaluateShare(share({ maxViews: null, viewCount: 10_000 }), OPEN, NOW)).toEqual({
        ok: true,
      });
    });

    /** A cap of zero is a link that never opens. Honoured rather than treated as
     *  "unset", because the alternative silently turns it into unlimited. */
    it("treats a cap of zero as closed, not as unlimited", () => {
      expect(evaluateShare(share({ maxViews: 0, viewCount: 0 }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "exhausted",
      });
    });
  });

  describe("passwords", () => {
    it("asks when one is set and the viewer has not entered it", () => {
      expect(evaluateShare(share({ passwordHash: "hash" }), OPEN, NOW)).toEqual({
        ok: false,
        reason: "password",
      });
    });

    it("opens once the viewer has", () => {
      expect(evaluateShare(share({ passwordHash: "hash" }), UNLOCKED, NOW)).toEqual({ ok: true });
    });

    /** An unlocked cookie must not survive the link expiring, which is the whole
     *  reason expiry is checked before the password rather than after. */
    it("does not let an unlocked viewer past an expired link", () => {
      expect(
        evaluateShare(
          share({ passwordHash: "hash", expiresAt: new Date("2026-01-01") }),
          UNLOCKED,
          NOW,
        ),
      ).toEqual({ ok: false, reason: "expired" });
    });

    it("does not let an unlocked but uncounted viewer past a spent link", () => {
      expect(
        evaluateShare(share({ passwordHash: "hash", maxViews: 1, viewCount: 1 }), UNLOCKED, NOW),
      ).toEqual({ ok: false, reason: "exhausted" });
    });
  });
});

describe("share tokens", () => {
  it("are 22 characters, so the token is the whole secret", () => {
    expect(generateShareToken()).toHaveLength(22);
  });

  it("use only URL-safe characters, so no link survives being mangled by an encoder", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("do not repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateShareToken));
    expect(tokens.size).toBe(500);
  });
});

describe("share passwords", () => {
  it("round-trip", async () => {
    const hash = await hashSharePassword("open-sesame");
    expect(hash).not.toContain("open-sesame");
    await expect(verifySharePassword("open-sesame", hash)).resolves.toBe(true);
    await expect(verifySharePassword("open-sesam", hash)).resolves.toBe(false);
  });
});

describe("refusals", () => {
  const ALL: ShareDenial[] = ["not_found", "revoked", "expired", "exhausted", "password"];

  it("all have copy written for the person holding the link", () => {
    for (const reason of ALL) {
      expect(DENIAL_COPY[reason].title.length).toBeGreaterThan(0);
      expect(DENIAL_COPY[reason].detail.length).toBeGreaterThan(0);
    }
  });

  /**
   * 410 rather than 404 for something that existed and stopped. The recipient
   * already has the link, so telling them it was switched off reveals nothing
   * they did not know, and it is the difference between "ask for a new one" and
   * "I must have mistyped it".
   */
  it("map to statuses that distinguish gone from never-existed", () => {
    expect(denialStatus("not_found")).toBe(404);
    expect(denialStatus("password")).toBe(401);
    expect(denialStatus("revoked")).toBe(410);
    expect(denialStatus("expired")).toBe(410);
    expect(denialStatus("exhausted")).toBe(410);
  });
});

describe("the organizer's preset choices", () => {
  it("both lead with the unrestricted option, so the default is the obvious one", () => {
    expect(EXPIRY_OPTIONS[0].value).toBeNull();
    expect(VIEW_LIMIT_OPTIONS[0].value).toBeNull();
  });

  it("stay inside what the API will accept, so no preset can produce a 400", () => {
    for (const option of EXPIRY_OPTIONS) {
      if (option.value !== null) {
        expect(option.value).toBeGreaterThanOrEqual(1);
        expect(option.value).toBeLessThanOrEqual(365);
      }
    }
    for (const option of VIEW_LIMIT_OPTIONS) {
      if (option.value !== null) {
        expect(option.value).toBeGreaterThanOrEqual(1);
        expect(option.value).toBeLessThanOrEqual(MAX_SHARE_VIEWS);
      }
    }
  });
});

/**
 * The payload that goes to an organizer's browser.
 *
 * Asserted as an allowlist, by exact key set, rather than by checking that the
 * hash is absent. SEC-10 was this exact bug one layer over: a denylist on the
 * event payload that leaked retention fields to guests because nobody updated it
 * when a column was added. A key-set assertion fails when a column is added,
 * which is the moment the decision needs making.
 */
describe("toManagedShare", () => {
  const share = {
    id: "shr_1",
    token: "abcdefghijklmnopqrstuv",
    eventId: "evt_1",
    mediaId: "med_1",
    albumId: null,
    scope: "media",
    createdByUserId: "usr_1",
    createdByGuestId: null,
    allowDownload: true,
    passwordHash: "$2a$10$aVeryRealLookingBcryptHashValue",
    expiresAt: new Date("2026-11-01T00:00:00Z"),
    maxViews: 5,
    viewCount: 2,
    revokedAt: null,
    createdAt: new Date("2026-10-03T00:00:00Z"),
  } as MediaShare;

  const item = { id: "med_1", kind: "photo" } as Media;
  const row = (overrides: Partial<MediaShare> = {}) => ({
    share: { ...share, ...overrides },
    item,
    albumName: null,
    itemCount: null,
    previewMediaId: null,
    previewKind: null,
  });

  it("emits exactly the fields the UI needs, and no others", () => {
    expect(Object.keys(toManagedShare(row())).sort()).toEqual(
      [
        "albumId",
        "albumName",
        "allowDownload",
        "createdAt",
        "expiresAt",
        "hasPassword",
        "id",
        "itemCount",
        "maxViews",
        "mediaId",
        "mediaKind",
        "previewKind",
        "previewMediaId",
        "revokedAt",
        "scope",
        "token",
        "url",
        "viewCount",
      ].sort(),
    );
  });

  it("never sends the password hash, only whether one is set", () => {
    const payload = toManagedShare(row());
    expect(JSON.stringify(payload)).not.toContain("$2a$");
    expect(payload.hasPassword).toBe(true);
    expect(toManagedShare(row({ passwordHash: null })).hasPassword).toBe(false);
  });

  /** Dates become strings over JSON whatever the type says, so they are
   *  converted here rather than left for a `getTime` on a string to discover. */
  it("serialises timestamps as strings, matching what the client receives", () => {
    const payload = toManagedShare(row());
    expect(payload.expiresAt).toBe("2026-11-01T00:00:00.000Z");
    expect(payload.createdAt).toBe("2026-10-03T00:00:00.000Z");
    expect(payload.revokedAt).toBeNull();
  });

  it("builds an absolute link, since this is the thing being pasted into chat", () => {
    expect(toManagedShare(row()).url).toBe(
      "https://example.test/s/abcdefghijklmnopqrstuv",
    );
  });
});

describe("folder and selection links", () => {
  it("are the scopes that open several photos", () => {
    expect(["media", "album", "selection", "event"].filter(isCollectionScope)).toEqual(["album", "selection"]);
  });

  it("word a refusal for several photos only where the words name them", () => {
    expect(denialCopy("password", true).title).toBe("These photos need a password.");
    expect(denialCopy("revoked", true).detail).toContain("these photos");
    expect(denialCopy("expired", true)).toEqual(DENIAL_COPY.expired);
    expect(denialCopy("password")).toEqual(DENIAL_COPY.password);
  });

  it("name a ZIP after neither the event nor the link", () => {
    expect(shareZipFilename(1, 1)).toBe("klik-shared-photos.zip");
    expect(shareZipFilename(2, 3)).toBe("klik-shared-photos-part-2-of-3.zip");
  });
});
