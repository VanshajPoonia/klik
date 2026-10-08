import { describe, expect, it } from "vitest";
import { likePrefix, suggestUsernames, usernameStem, validateUsername } from "./username";
import { generateUsername } from "./credentials";

const reason = (raw: string) => {
  const check = validateUsername(raw);
  return check.ok ? null : check.reason;
};

describe("validateUsername", () => {
  it("accepts a plain handle and lowercases it", () => {
    expect(validateUsername("Anita_K")).toEqual({ ok: true, username: "anita_k" });
  });

  it("drops one leading @, since that is how handles are shown", () => {
    expect(validateUsername("@anita")).toEqual({ ok: true, username: "anita" });
  });

  it("holds the length to 3 to 20", () => {
    expect(reason("ab")).toMatch(/3/);
    expect(reason("a".repeat(21))).toMatch(/20/);
    expect(reason("a".repeat(20))).toBeNull();
  });

  it("starts with a letter and uses only letters, numbers and underscores", () => {
    expect(reason("1anita")).toMatch(/letter/);
    expect(reason("_anita")).toMatch(/letter/);
    expect(reason("an.ita")).toMatch(/underscores only/);
    expect(reason("an ita")).toMatch(/underscores only/);
    expect(reason("anïta")).toMatch(/underscores only/);
  });

  it("refuses doubled and trailing underscores", () => {
    expect(reason("an__ita")).toMatch(/underscore/);
    expect(reason("anita_")).toMatch(/underscore/);
  });

  it("reserves every route and the names that look official", () => {
    for (const word of ["admin", "api", "dashboard", "signup", "klik", "support", "Klik_Support"]) {
      expect(reason(word)).toMatch(/reserved/);
    }
  });
});

describe("generated handles", () => {
  it("already follow the rules, so nothing new needs grandfathering", () => {
    for (const seed of ["Daniel", "info", "!!!", "Ünïcødé Wedding Venue LLC", "123 Main St", "x"]) {
      const check = validateUsername(generateUsername(seed));
      expect(check.ok, generateUsername(seed)).toBe(true);
    }
  });
});

describe("usernameStem", () => {
  it("folds accents, spaces and punctuation into one underscore", () => {
    expect(usernameStem("José  María-López")).toBe("jose_maria_lopez");
  });
  it("drops leading digits, which a handle cannot start with", () => {
    expect(usernameStem("2024 wedding")).toBe("wedding");
  });
});

describe("suggestUsernames", () => {
  it("offers handles from the name and the email, all valid", () => {
    const suggestions = suggestUsernames("Anita Kapoor", "anita.k@example.com");
    expect(suggestions).toContain("anita_kapoor");
    expect(suggestions).toContain("anitakapoor");
    expect(suggestions).toContain("anita_k");
    for (const suggestion of suggestions) expect(validateUsername(suggestion).ok).toBe(true);
  });
  it("is empty rather than invalid when there is nothing to work from", () => {
    expect(suggestUsernames(null, null)).toEqual([]);
  });
});

describe("likePrefix", () => {
  it("escapes the underscore, which LIKE reads as any character", () => {
    expect(likePrefix("a_b")).toBe("a\\_b%");
    expect(likePrefix("100%")).toBe("100\\%%");
  });
});
