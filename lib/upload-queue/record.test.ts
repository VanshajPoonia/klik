import { describe, expect, it } from "vitest";
import { backoffMs, isTransient, newQueuedUpload, nextClaimable, nextWakeAt, type QueuedUpload } from "./record";

const context = { eventId: "e1", slug: "party", albumId: null, maxVideoSeconds: 60 };

function item(id: string, patch: Partial<QueuedUpload> = {}): QueuedUpload {
  return { ...newQueuedUpload(id, { file: new File(["x"], `${id}.jpg`, { type: "image/jpeg" }) }, context, 1_000), ready: true, ...patch };
}

describe("a queued upload", () => {
  it("starts unprepared, unsent and unrefused, with what the picker said about the file", () => {
    const video = newQueuedUpload("v1", { file: new File(["x"], "clip.mov", { type: "video/quicktime" }), challengeId: "c1" }, context);
    expect(video).toMatchObject({ kind: "video", name: "clip.mov", mimeType: "video/quicktime", ready: false, challengeId: "c1", refused: null });
    expect(video.sent).toEqual({ pathname: null, multipart: null, posterPathname: null, thumbPathname: null, stored: false, restarted: false });
  });

  it("tells a passing failure from a refusal", () => {
    for (const status of [0, 408, 429, 500, 502, 503]) expect(isTransient(status)).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 413, 415, 422]) expect(isTransient(status)).toBe(false);
  });

  it("waits longer after each try, up to five minutes", () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(50)).toBe(300_000);
  });
});

describe("which item goes next", () => {
  it("is the oldest ready one nobody holds, refused and unprepared ones left alone", () => {
    const now = 10_000;
    const items = [
      item("refused", { addedAt: 1, refused: { message: "Full", status: 413 } }),
      item("unready", { addedAt: 2, ready: false }),
      item("held", { addedAt: 3, claim: { by: "other", until: now + 1 } }),
      item("later", { addedAt: 4, retryAt: now + 5_000 }),
      item("second", { addedAt: 6 }),
      item("first", { addedAt: 5 }),
    ];
    expect(nextClaimable(items, now)?.id).toBe("first");
    expect(nextClaimable(items.filter((entry) => entry.id !== "first"), now)?.id).toBe("second");
  });

  it("takes an item whose holder stopped renewing", () => {
    expect(nextClaimable([item("stale", { claim: { by: "frozen-page", until: 5 } })], 10)?.id).toBe("stale");
  });

  it("knows when to look again: the soonest retry or lapsing hold", () => {
    const now = 100;
    expect(
      nextWakeAt([item("a", { retryAt: 500 }), item("b", { claim: { by: "x", until: 300 } }), item("c", { retryAt: 50 })], now),
    ).toBe(300);
    expect(nextWakeAt([item("a"), item("r", { retryAt: 900, refused: { message: "No", status: 403 } })], now)).toBeNull();
  });
});
