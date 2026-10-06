import { describe, expect, it } from "vitest";
import { onboardingEmail } from "./onboarding";
import { KIT_WAIT_MINUTES, SUPPORT_PHONE } from "../support";

/**
 * This email is the only thing that reaches somebody who created an account and
 * then closed the tab. If it does not get them back to a price, it has failed at
 * the one job it has beyond being polite.
 */

const APP_URL = "https://example.test";

describe("onboardingEmail", () => {
  const message = onboardingEmail({ name: "Daniel", appUrl: APP_URL });

  it("links to the plans, which is the point of sending it", () => {
    expect(message.html).toContain(`${APP_URL}/#pricing`);
    expect(message.text).toContain(`${APP_URL}/#pricing`);
  });

  it("carries the support number in both parts", () => {
    expect(message.html).toContain(SUPPORT_PHONE);
    expect(message.text).toContain(SUPPORT_PHONE);
  });

  /**
   * The wait is the expectation this email exists to set. Left out, the reader
   * meets it as a blank dashboard instead, and reads that as a failed payment.
   */
  it("states the wait before anyone has paid", () => {
    expect(message.html).toContain(`${KIT_WAIT_MINUTES} minutes`);
    expect(message.text).toContain(`${KIT_WAIT_MINUTES} minutes`);
  });

  /**
   * A mail with no text part is scored down by every filter that looks, and an
   * HTML-only welcome is sometimes an invisible one.
   */
  it("always has a plain text alternative", () => {
    expect(message.text.length).toBeGreaterThan(200);
  });

  it("greets by name when there is one, and still reads correctly without", () => {
    expect(message.html).toContain("Hi Daniel");
    const anonymous = onboardingEmail({ name: null, appUrl: APP_URL });
    expect(anonymous.html).toContain("Hi, welcome to Klik");
    expect(anonymous.html).not.toContain("Hi null");
  });

  it("treats a blank name as no name", () => {
    expect(onboardingEmail({ name: "   ", appUrl: APP_URL }).html).toContain("Hi, welcome");
  });

  /**
   * The name is typed by a stranger and interpolated into HTML that somebody
   * else's mail client renders.
   */
  it("escapes the name rather than trusting it", () => {
    const hostile = onboardingEmail({
      name: '<script>alert(1)</script>',
      appUrl: APP_URL,
    });
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("leaves no recipient for the caller to forget to set", () => {
    // `to` is deliberately absent from the returned object, so a send cannot
    // compile with an empty string standing in for a real address.
    expect("to" in message).toBe(false);
  });

  it("has a subject that says what to do, not just hello", () => {
    expect(message.subject).toMatch(/klik/i);
    expect(message.subject.length).toBeLessThan(80);
  });
});
