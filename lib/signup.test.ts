import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  normalizeEmail,
  passwordRestatesEmail,
  signupSchema,
  usernameFromEmail,
} from "./signup";

/**
 * Signup is the first endpoint on Klik that creates an account without a
 * superadmin in the loop, so these are the rules standing between a form on the
 * open internet and a row in `users`. Each test below is a specific way that
 * could go wrong, not a restatement of the schema.
 */

describe("normalizeEmail", () => {
  it("lowercases and trims, so one address cannot become two accounts", () => {
    expect(normalizeEmail("  Sam@Venue.COM ")).toBe("sam@venue.com");
  });

  /**
   * The tempting extra step, and the wrong one. Dot-insensitivity is a Gmail
   * convention, and applying it everywhere means `first.last@company.com` and
   * `firstlast@company.com` collapse into one account at the many providers
   * where those are two different employees.
   */
  it("leaves dots and plus tags alone", () => {
    expect(normalizeEmail("first.last+klik@company.com")).toBe("first.last+klik@company.com");
  });
});

describe("usernameFromEmail", () => {
  it("builds a username from the local part", () => {
    expect(usernameFromEmail("daniel@venue.com")).toMatch(/^daniel\.[a-z0-9]{4}$/);
  });

  it("gives two people at the same address different usernames", () => {
    // The suffix is what makes a unique constraint on `username` survive a
    // second signup from the same local part at a different domain.
    const first = usernameFromEmail("info@venue-a.com");
    const second = usernameFromEmail("info@venue-b.com");
    expect(first).not.toBe(second);
  });

  it("never produces an empty username", () => {
    // `generateUsername` falls back to "client" for a local part with nothing
    // sluggable in it. Without that, the username would be a bare suffix.
    expect(usernameFromEmail("!!!@venue.com")).toMatch(/^client\.[a-z0-9]{4}$/);
  });
});

describe("passwordRestatesEmail", () => {
  it("catches the password everyone chooses first", () => {
    expect(passwordRestatesEmail("daniel2024!", "daniel@venue.com")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(passwordRestatesEmail("DANIEL-is-here", "daniel@venue.com")).toBe(true);
  });

  /**
   * A short local part would otherwise reject half the dictionary: `jo@x.com`
   * would fail every password containing "jo", including "projection".
   */
  it("ignores local parts too short to mean anything", () => {
    expect(passwordRestatesEmail("projectionbooth", "jo@venue.com")).toBe(false);
  });

  it("passes an unrelated password", () => {
    expect(passwordRestatesEmail("correct-horse-battery", "daniel@venue.com")).toBe(false);
  });
});

describe("signupSchema", () => {
  const valid = {
    name: "Daniel Reed",
    email: "Daniel@Venue.com",
    password: "correct-horse-battery",
  };

  it("accepts a reasonable signup and normalises the email", () => {
    const parsed = signupSchema.parse(valid);
    expect(parsed.email).toBe("daniel@venue.com");
    expect(parsed.name).toBe("Daniel Reed");
  });

  it("trims the name rather than storing the whitespace", () => {
    expect(signupSchema.parse({ ...valid, name: "  Daniel Reed  " }).name).toBe("Daniel Reed");
  });

  it("rejects a name that is only whitespace", () => {
    expect(signupSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects something that is not an email", () => {
    expect(signupSchema.safeParse({ ...valid, email: "daniel at venue" }).success).toBe(false);
  });

  it(`rejects a password shorter than ${PASSWORD_MIN}`, () => {
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(PASSWORD_MIN - 1) }).success).toBe(
      false,
    );
  });

  /**
   * bcrypt hashes the first 72 bytes and silently drops the rest. Accepting a
   * longer password would store a shorter secret than the person chose, and
   * they would never find out.
   */
  it(`rejects a password longer than ${PASSWORD_MAX}, which bcrypt would truncate`, () => {
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(PASSWORD_MAX + 1) }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...valid, password: "a".repeat(PASSWORD_MAX) }).success).toBe(
      true,
    );
  });

  it("rejects a password built out of the email address", () => {
    const result = signupSchema.safeParse({ ...valid, password: "danieldaniel1" });
    expect(result.success).toBe(false);
    // Reported against the password field, so the form marks the right input.
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["password"]);
    }
  });

  it("rejects a missing body", () => {
    expect(signupSchema.safeParse(null).success).toBe(false);
    expect(signupSchema.safeParse({}).success).toBe(false);
  });
});
