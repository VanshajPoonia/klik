import { describe, expect, it } from "vitest";
import { videoHeldBack } from "./media-access";

describe("videoHeldBack", () => {
  const video = (metadataState: "pending" | "clean" | "failed" | null, guestId: string | null = "g1") => ({
    kind: "video" as const,
    metadataState,
    guestId,
  });

  it("holds a pending or failed guest video back from everyone but the guest who filmed it", () => {
    for (const state of ["pending", "failed"] as const) {
      expect(videoHeldBack(video(state), { isManager: false, guestId: "g1" })).toBe(false);
      expect(videoHeldBack(video(state), { isManager: false, guestId: "g2" })).toBe(true);
      expect(videoHeldBack(video(state), { isManager: false, guestId: null })).toBe(true);
      expect(videoHeldBack(video(state), { isManager: true, guestId: null })).toBe(true);
    }
  });

  it("lets a manager see their own upload, which has no guest", () => {
    expect(videoHeldBack(video("pending", null), { isManager: true, guestId: null })).toBe(false);
    expect(videoHeldBack(video("pending", null), { isManager: false, guestId: "g1" })).toBe(true);
  });

  it("holds nothing back once clean, before this existed, or for a photo", () => {
    expect(videoHeldBack(video("clean"), { isManager: false, guestId: null })).toBe(false);
    expect(videoHeldBack(video(null), { isManager: false, guestId: null })).toBe(false);
    expect(
      videoHeldBack({ kind: "photo", metadataState: "pending", guestId: "g1" }, { isManager: false, guestId: null }),
    ).toBe(false);
  });
});
