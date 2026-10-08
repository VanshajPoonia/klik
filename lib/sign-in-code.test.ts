import { describe, expect, it } from "vitest";
import { generateSignInCode, normalizeSignInEmail } from "./sign-in-code";
import { describeSignInError, readSignInCodeCookie } from "./sign-in-errors";

describe("generateSignInCode", () => {
  it("is always six digits, leading zeros kept", () => {
    for (let i = 0; i < 500; i += 1) expect(generateSignInCode()).toMatch(/^\d{6}$/);
  });
});

describe("normalizeSignInEmail", () => {
  it("matches what Auth.js stores, so the guess limit cannot be stepped around", () => {
    expect(normalizeSignInEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(normalizeSignInEmail("ana@example.com,other.com")).toBe("ana@example.com");
    // A fullwidth @ becomes a real one under NFKC, as it does in Auth.js.
    expect(normalizeSignInEmail("ana＠example.com")).toBe("ana@example.com");
  });
});

describe("readSignInCodeCookie", () => {
  it("reads back what the form wrote", () => {
    const value = encodeURIComponent(JSON.stringify({ email: "ana@example.com", next: "/e/wedding" }));
    expect(readSignInCodeCookie(value)).toEqual({ email: "ana@example.com", next: "/e/wedding" });
  });
  it("is null for anything else", () => {
    expect(readSignInCodeCookie(undefined)).toBeNull();
    expect(readSignInCodeCookie("%7Bnot json")).toBeNull();
    expect(readSignInCodeCookie(encodeURIComponent(JSON.stringify({ email: "no-at-sign" })))).toBeNull();
  });
});

describe("describeSignInError", () => {
  it("says something useful for the codes that come back", () => {
    expect(describeSignInError("Verification")).toMatch(/code/);
    expect(describeSignInError("TooManyAttempts")).toMatch(/Too many/);
    expect(describeSignInError("SomethingNew")).toMatch(/Could not sign you in/);
    expect(describeSignInError(undefined)).toBeNull();
  });
});
