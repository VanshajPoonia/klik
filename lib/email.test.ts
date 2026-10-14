import { describe, expect, it } from "vitest";
import { BULK_EMAIL_DAILY_LIMIT, EMAIL_DAILY_LIMIT, sendEmail, untilEmailDayResets } from "./email";

const MINUTE = 60 * 1000;

describe("the daily email limit", () => {
  it("stays under Resend's free 100 a day, with bulk mail giving way first", () => {
    expect(EMAIL_DAILY_LIMIT).toBeLessThan(100);
    expect(BULK_EMAIL_DAILY_LIMIT).toBeLessThan(EMAIL_DAILY_LIMIT);
  });

  it("resets just after midnight UTC, not 24 hours after the last send", () => {
    expect(untilEmailDayResets(new Date("2026-10-14T23:59:00Z"))).toBe(6 * MINUTE);
    expect(untilEmailDayResets(new Date("2026-10-14T00:00:00Z"))).toBe(24 * 60 * MINUTE + 5 * MINUTE);
    expect(untilEmailDayResets(new Date("2026-12-31T22:00:00Z"))).toBe(2 * 60 * MINUTE + 5 * MINUTE);
  });

  it("does not count a send that was never going to happen", async () => {
    // No Resend key in the test environment: this must return before the
    // database is touched, or the test would fail on a connection.
    await expect(sendEmail({ to: "a@example.test", subject: "s", html: "<p>h</p>", text: "t" })).resolves.toEqual({
      sent: false,
      reason: "not_configured",
    });
  });
});
