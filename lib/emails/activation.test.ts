import { describe, expect, it } from "vitest";
import { activationEmail } from "./activation";
import { SUPPORT_PHONE } from "../support";

/**
 * This is the email that closes the buying loop. Somebody paid, a superadmin
 * granted the plan, and until this arrives they have no way of knowing any of
 * it happened. Everything asserted here is something whose absence sends them to
 * the support number instead of to their dashboard.
 */

const APP_URL = "https://example.test";
const base = { name: "Daniel", planName: "Klik Event", username: null, appUrl: APP_URL };

describe("activationEmail", () => {
  const message = activationEmail(base);

  it("links to the dashboard, which is the one thing it is for", () => {
    expect(message.html).toContain(`${APP_URL}/dashboard`);
    expect(message.text).toContain(`${APP_URL}/dashboard`);
  });

  it("names the plan that was granted, so it is clear what was bought", () => {
    expect(message.html).toContain("Klik Event");
    expect(message.text).toContain("Klik Event");
  });

  /**
   * Five steps, and the order is the order they happen in. The gallery, the QR
   * and the sign are the deliverable, so each has to be named: "your account is
   * active" on its own tells somebody holding a printed sign nothing.
   */
  it("walks through every step from signing in to downloading", () => {
    for (const part of [message.html, message.text]) {
      expect(part).toContain("Create your event");
      expect(part).toContain("QR code");
      expect(part).toContain("printable sign");
      expect(part).toContain("zip");
    }
  });

  /**
   * The event does not exist when this is sent, so the QR cannot exist either.
   * Promising it outright sends somebody hunting their dashboard for a thing
   * that is one click away but not yet made.
   */
  it("does not claim the QR code already exists", () => {
    expect(message.html).not.toMatch(/your QR code is (ready|waiting|attached)/i);
    expect(message.text).toContain("generated on the spot");
  });

  it("carries the support number in both parts", () => {
    expect(message.html).toContain(SUPPORT_PHONE);
    expect(message.text).toContain(SUPPORT_PHONE);
  });

  /**
   * An account created at /admin/new was handed a generated username it has
   * never seen. Telling it to sign in "with this email address" is advice that
   * does not work, and the reader cannot tell which case they are in.
   */
  it("tells an admin-created account its username, and never invents one", () => {
    const named = activationEmail({ ...base, username: "quiet-harbor-41" });
    expect(named.html).toContain("quiet-harbor-41");
    expect(named.text).toContain("quiet-harbor-41");

    expect(message.html).toContain("this email address");
    expect(message.html).not.toContain("username");
  });

  it("always has a plain text alternative", () => {
    expect(message.text.length).toBeGreaterThan(200);
  });

  it("greets by name when there is one, and still reads correctly without", () => {
    expect(message.html).toContain("Hi Daniel");
    const anonymous = activationEmail({ ...base, name: null });
    expect(anonymous.html).toContain("Hi, you are all set");
    expect(anonymous.html).not.toContain("Hi null");
  });

  it("treats a blank name as no name", () => {
    expect(activationEmail({ ...base, name: "   " }).html).toContain("Hi, you are all set");
  });

  /** Both of these reach the template from outside and land in HTML. */
  it("escapes the name and the plan name rather than trusting them", () => {
    const hostile = activationEmail({
      ...base,
      name: "<script>alert(1)</script>",
      planName: "<img src=x onerror=alert(1)>",
    });
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).not.toContain("<img src=x");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("leaves no recipient for the caller to forget to set", () => {
    expect("to" in message).toBe(false);
  });

  it("has a subject that says what happened and what to do", () => {
    expect(message.subject).toMatch(/klik/i);
    expect(message.subject.length).toBeLessThan(80);
  });
});
