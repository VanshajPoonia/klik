import { describe, expect, it } from "vitest";
import { playbackMimeType } from "./storage";

describe("playbackMimeType", () => {
  it("names an iPhone's QuickTime video MP4 for a browser that asks", () => {
    expect(playbackMimeType("video/quicktime", "mp4")).toBe("video/mp4");
  });

  it("leaves it as QuickTime for Safari, which never asks", () => {
    expect(playbackMimeType("video/quicktime", null)).toBe("video/quicktime");
  });

  it("changes nothing else, whatever is asked", () => {
    expect(playbackMimeType("video/webm", "mp4")).toBe("video/webm");
    expect(playbackMimeType("image/jpeg", "mp4")).toBe("image/jpeg");
    expect(playbackMimeType("video/quicktime", "webm")).toBe("video/quicktime");
  });
});
