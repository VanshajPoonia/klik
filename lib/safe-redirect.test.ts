import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-redirect";

/**
 * This guards a sign-in redirect, so the failure it prevents is an open
 * redirect: a link that wears klik's domain, signs someone in, and drops them
 * on an attacker's page ready to ask for the password again. Everything that
 * does not plainly resolve inside Klik must come back null.
 */
describe("safeInternalPath", () => {
  it("keeps an ordinary internal path", () => {
    expect(safeInternalPath("/checkout?plan=event")).toBe("/checkout?plan=event");
    expect(safeInternalPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/e/some-slug#top")).toBe("/e/some-slug#top");
  });

  it.each([
    ["an absolute URL", "https://evil.example/pwn"],
    ["a scheme-only absolute", "http://evil.example"],
    ["a protocol-relative URL", "//evil.example/pwn"],
    ["a backslash protocol-relative", "/\\evil.example"],
    ["a backslash anywhere", "/dashboard\\@evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a bare path with no leading slash", "dashboard"],
    ["an empty string", ""],
    ["a tab-smuggled scheme", "/\tjavascript:alert(1)"],
    ["a newline", "/dashboard\nLocation: https://evil.example"],
  ])("refuses %s", (_label, input) => {
    expect(safeInternalPath(input)).toBeNull();
  });

  it("refuses null and undefined", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });

  /**
   * Traversal cannot escape the origin, so it is allowed through rather than
   * rejected, but it must come back normalised. "/a/../b" and "/b" reaching
   * different code paths is how a check and the thing it guards disagree.
   */
  it("normalises traversal rather than leaving it to the browser", () => {
    expect(safeInternalPath("/dashboard/../checkout")).toBe("/checkout");
    expect(safeInternalPath("/../../../etc/passwd")).toBe("/etc/passwd");
  });
});
