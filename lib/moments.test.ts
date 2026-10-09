import { describe, expect, it } from "vitest";
import {
  clusterMoments,
  findBursts,
  momentNames,
  momentTime,
  wallClockOffsetMinutes,
  wallMs,
  type MomentInput,
} from "./moments";

// A New York evening: walls say 18:00, UTC says 23:00.
const at = (wall: string) => wall.replace("T", " ");
const utcPlus = (wall: string, hours: number, minutes = 0) =>
  new Date(Date.parse(`${wall}Z`) + hours * 3_600_000 + minutes * 60_000);

let sequence = 0;
function photo(wall: string | null, uploaded: Date, guestId: string | null = "g1"): MomentInput {
  sequence += 1;
  return { id: `m${sequence}`, guestId, capturedAt: wall ? at(wall) : null, createdAt: uploaded };
}

/** n photos every `everySeconds` from `startWall`, captured, uploaded five hours and two minutes later. */
function run(startWall: string, n: number, everySeconds: number, guestId = "g1"): MomentInput[] {
  return Array.from({ length: n }, (_, index) => {
    const t = new Date(Date.parse(`${startWall}Z`) + index * everySeconds * 1000).toISOString().slice(0, 19);
    return photo(t, utcPlus(t, 5, 2), guestId);
  });
}

describe("wall clock", () => {
  it("reads both spellings of a wall time, and nothing else", () => {
    expect(wallMs("2026-07-04 18:30:00")).toBe(Date.UTC(2026, 6, 4, 18, 30));
    expect(wallMs("2026-07-04T18:30:00")).toBe(Date.UTC(2026, 6, 4, 18, 30));
    expect(wallMs("yesterday")).toBeNull();
    expect(wallMs(null)).toBeNull();
  });

  it("finds the zone from photos with both clocks, ignoring a late uploader", () => {
    const items = [...run("2026-07-04T18:00:00", 6, 60), photo("2026-07-04T19:00:00", utcPlus("2026-07-05T12:00:00", 5))];
    expect(wallClockOffsetMinutes(items)).toBe(300);
    expect(wallClockOffsetMinutes([photo(null, new Date())])).toBe(0);
  });

  it("puts a photo with no capture time on the same clock as the rest", () => {
    const uploaded = utcPlus("2026-07-04T18:10:00", 5);
    expect(momentTime(photo(null, uploaded), 300)).toBe(Date.UTC(2026, 6, 4, 18, 10));
  });

  it("does not trust a camera whose clock is days out", () => {
    const wrong = Array.from({ length: 5 }, () => photo("2020-01-01T00:00:00", new Date("2026-07-04T23:00:00Z")));
    expect(wallClockOffsetMinutes(wrong)).toBe(0);
  });
});

describe("moments", () => {
  it("cuts at long quiet spells, and leaves a busy stretch whole", () => {
    const items = [
      ...run("2026-07-04T13:00:00", 20, 30), // ceremony, ten minutes
      ...run("2026-07-04T15:00:00", 30, 60), // drinks, half an hour
      ...run("2026-07-04T19:30:00", 40, 45), // dancing
    ];
    const { offsetMinutes, moments } = clusterMoments(items);
    expect(offsetMinutes).toBe(300);
    expect(moments.map((moment) => moment.ids.length)).toEqual([20, 30, 40]);
  });

  it("files an upload with no capture time into the moment it was taken in", () => {
    const items = [...run("2026-07-04T13:00:00", 10, 30), ...run("2026-07-04T19:00:00", 10, 30)];
    const late = photo(null, utcPlus("2026-07-04T19:02:00", 5));
    const { moments } = clusterMoments([...items, late]);
    expect(moments[1].ids).toContain(late.id);
  });

  it("folds a stray photo into its nearer neighbour rather than giving it a tab", () => {
    const items = [...run("2026-07-04T13:00:00", 10, 30), photo("2026-07-04T14:00:00", utcPlus("2026-07-04T14:00:00", 5))];
    expect(clusterMoments(items).moments).toHaveLength(1);
  });

  it("widens the gap until a long event fits in twelve", () => {
    const items = Array.from({ length: 30 }, (_, hour) =>
      run(`2026-07-0${4 + Math.floor(hour / 24)}T${String(hour % 24).padStart(2, "0")}:00:00`, 3, 20),
    ).flat();
    expect(clusterMoments(items).moments.length).toBeLessThanOrEqual(12);
  });

  it("is empty for an empty event", () => {
    expect(clusterMoments([]).moments).toEqual([]);
  });
});

describe("bursts", () => {
  it("stacks five or more inside ten seconds from one person, behind the first", () => {
    const burst = run("2026-07-04T20:00:00", 6, 1);
    const slow = run("2026-07-04T20:05:00", 6, 30);
    const map = findBursts([...burst, ...slow]);
    expect(burst.every((item) => map.get(item.id) === burst[0].id)).toBe(true);
    expect(slow.some((item) => map.has(item.id))).toBe(false);
  });

  it("does not stack two people shooting the same second, or a batch of uploads", () => {
    const two = [...run("2026-07-04T20:00:00", 3, 1, "a"), ...run("2026-07-04T20:00:00", 3, 1, "b")];
    expect(findBursts(two).size).toBe(0);
    const batch = Array.from({ length: 8 }, () => photo(null, new Date("2026-07-04T23:00:00Z")));
    expect(findBursts(batch).size).toBe(0);
  });
});

describe("moment names", () => {
  it("uses the part of the day, the weekday across days, and a time where two would match", () => {
    expect(momentNames([{ start: Date.UTC(2026, 6, 4, 9) }, { start: Date.UTC(2026, 6, 4, 14) }])).toEqual([
      "Morning",
      "Afternoon",
    ]);
    expect(momentNames([{ start: Date.UTC(2026, 6, 4, 19) }, { start: Date.UTC(2026, 6, 5, 10) }])).toEqual([
      "Saturday evening",
      "Sunday morning",
    ]);
    expect(momentNames([{ start: Date.UTC(2026, 6, 4, 13, 5) }, { start: Date.UTC(2026, 6, 4, 15, 40) }])).toEqual([
      "Afternoon, 1:05 PM",
      "Afternoon, 3:40 PM",
    ]);
  });
});
