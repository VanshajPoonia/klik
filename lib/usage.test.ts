import { describe, expect, it } from "vitest";
import { eventUsage, wouldExceedStorage } from "./usage";

const GB = 1024 ** 3;
const plan = { maxStorageBytesPerEvent: 100 * GB, photoHeadline: 5000, uploadWindowDays: 30 };
const base = { mediaBytes: 0, mediaCount: 0, licensedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-09-01T00:00:00Z") };

describe("eventUsage", () => {
  it("names the highest threshold crossed, and nothing below 75", () => {
    expect(eventUsage({ ...base, mediaBytes: 74 * GB }, plan).level).toBe(0);
    expect(eventUsage({ ...base, mediaBytes: 75 * GB }, plan).level).toBe(75);
    expect(eventUsage({ ...base, mediaBytes: 95 * GB }, plan).level).toBe(90);
    expect(eventUsage({ ...base, mediaBytes: 100 * GB }, plan)).toMatchObject({ level: 100, full: true });
  });

  it("lets the photo count run past its headline without being full", () => {
    const usage = eventUsage({ ...base, mediaCount: 6000, mediaBytes: 10 * GB }, plan);
    expect(usage.headlinePercent).toBe(120);
    expect(usage.full).toBe(false);
  });

  it("counts upload days from going live, and has none for a draft", () => {
    const now = new Date("2026-10-21T00:00:00Z");
    expect(eventUsage(base, plan, now).uploadDaysLeft).toBe(10);
    expect(eventUsage({ ...base, licensedAt: null }, plan, now).uploadDaysLeft).toBeNull();
  });
});

describe("wouldExceedStorage", () => {
  it("refuses the upload that would cross the line, not the one that reaches it", () => {
    expect(wouldExceedStorage({ mediaBytes: 99 * GB }, plan, GB)).toBe(false);
    expect(wouldExceedStorage({ mediaBytes: 99 * GB }, plan, GB + 1)).toBe(true);
  });
});
