import { describe, expect, it } from "vitest";
import { timeAgo } from "./time-ago";

const now = new Date("2026-10-09T12:00:00Z").getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("timeAgo", () => {
  it("counts up through minutes, hours and days", () => {
    expect(timeAgo(ago(20_000), now)).toBe("now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3h");
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe("2d");
  });

  it("switches to the date after a week, with the year only when it differs", () => {
    expect(timeAgo("2026-09-20T12:00:00Z", now)).toBe("Sep 20");
    expect(timeAgo("2025-12-31T12:00:00Z", now)).toBe("Dec 31, 2025");
  });

  it("reads a clock slightly ahead of this one as now, and garbage as nothing", () => {
    expect(timeAgo(new Date(now + 5_000).toISOString(), now)).toBe("now");
    expect(timeAgo("not a date", now)).toBe("");
  });
});
