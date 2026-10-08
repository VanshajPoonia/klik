import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./job-runner";
import {
  BREAKER_MIN_ORPHANS,
  ORPHAN_GRACE_MS,
  breakerTrips,
  eventIdFromKey,
  planOrphans,
} from "./job-handlers/reap-orphans";

describe("retryDelayMs", () => {
  const noJitter = () => 0.5;

  it("backs off by a factor of four from thirty seconds", () => {
    expect(retryDelayMs(1, noJitter)).toBe(30_000);
    expect(retryDelayMs(2, noJitter)).toBe(120_000);
    expect(retryDelayMs(3, noJitter)).toBe(480_000);
  });

  it("caps at six hours however many attempts there have been", () => {
    expect(retryDelayMs(40, noJitter)).toBe(6 * 60 * 60 * 1000);
  });

  it("jitters within twenty percent either way", () => {
    expect(retryDelayMs(1, () => 0)).toBe(24_000);
    expect(retryDelayMs(1, () => 1)).toBe(36_000);
  });
});

describe("eventIdFromKey", () => {
  it("reads the event id out of a media key", () => {
    expect(eventIdFromKey("events/evt_1/abc.jpg")).toBe("evt_1");
    expect(eventIdFromKey("events/evt_1/abc-poster.jpg")).toBe("evt_1");
  });

  it("refuses anything not shaped like a media key", () => {
    expect(eventIdFromKey("exports/evt_1/all.zip")).toBeNull();
    expect(eventIdFromKey("events/evt_1/nested/abc.jpg")).toBeNull();
    expect(eventIdFromKey("events/abc.jpg")).toBeNull();
  });
});

describe("planOrphans", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const old = new Date(now - ORPHAN_GRACE_MS - 1);
  const fresh = new Date(now - ORPHAN_GRACE_MS + 60_000);

  it("finds old objects nothing references", () => {
    const plan = planOrphans(
      [
        { key: "events/e/kept.jpg", lastModified: old },
        { key: "events/e/orphan.jpg", lastModified: old },
      ],
      new Set(["events/e/kept.jpg"]),
      now,
    );
    expect(plan).toEqual({ eligible: 2, orphans: ["events/e/orphan.jpg"] });
  });

  it("never judges an object inside the grace window, which may be an upload in flight", () => {
    const plan = planOrphans([{ key: "events/e/new.jpg", lastModified: fresh }], new Set(), now);
    expect(plan).toEqual({ eligible: 0, orphans: [] });
  });

  it("treats an unknown age as new rather than as old", () => {
    const plan = planOrphans([{ key: "events/e/x.jpg", lastModified: null }], new Set(), now);
    expect(plan.orphans).toEqual([]);
  });

  it("leaves keys outside events/ alone even when unreferenced", () => {
    const plan = planOrphans([{ key: "exports/e/all.zip", lastModified: old }], new Set(), now);
    expect(plan).toEqual({ eligible: 0, orphans: [] });
  });
});

describe("breakerTrips", () => {
  it("does not trip on a handful of real orphans", () => {
    expect(breakerTrips(10, 10)).toBe(false);
    expect(breakerTrips(BREAKER_MIN_ORPHANS, BREAKER_MIN_ORPHANS)).toBe(false);
  });

  it("does not trip when orphans are a minority, however many", () => {
    expect(breakerTrips(1000, 400)).toBe(false);
  });

  it("trips when most of a large walk looks unreferenced, the shape of a query bug", () => {
    expect(breakerTrips(100, 60)).toBe(true);
  });
});
