import { describe, expect, it } from "vitest";
import { compareNewestFirst, mergeGalleryChanges, type SyncedItem } from "./gallery-sync";

const item = (id: string, minute: number, extra: Partial<SyncedItem> = {}): SyncedItem => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, 8, 12, minute)).toISOString(),
  src: `https://r2/${id}?sig=1`,
  thumbSrc: `https://r2/${id}-thumb?sig=1`,
  ...extra,
});

describe("compareNewestFirst", () => {
  it("orders by time, newest first, and breaks ties by id like the server", () => {
    const list = [item("a", 1), item("c", 2), item("b", 2)].sort(compareNewestFirst);
    expect(list.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });
});

describe("mergeGalleryChanges", () => {
  it("removes what the server says this viewer may no longer see", () => {
    const merged = mergeGalleryChanges([item("a", 3), item("b", 2)], [], ["a"], false);
    expect(merged.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("places a photo approved late at its own time, not at the top", () => {
    const merged = mergeGalleryChanges([item("new", 5), item("old", 1)], [item("approved", 3)], [], false);
    expect(merged.map((entry) => entry.id)).toEqual(["new", "approved", "old"]);
  });

  it("leaves an arrival older than everything loaded to the next page while history remains", () => {
    const merged = mergeGalleryChanges([item("b", 5), item("c", 4)], [item("ancient", 1)], [], true);
    expect(merged.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("keeps the URLs already on screen, so the browser does not download the photo again", () => {
    const merged = mergeGalleryChanges(
      [item("a", 1)],
      [item("a", 1, { src: "https://r2/a?sig=2", thumbSrc: "https://r2/a-thumb?sig=2" })],
      [],
      false,
    );
    expect(merged[0].src).toBe("https://r2/a?sig=1");
    expect(merged[0].thumbSrc).toBe("https://r2/a-thumb?sig=1");
  });

  it("does switch to a thumbnail that arrived after the tile was first shown", () => {
    const before = item("a", 1, { thumbSrc: "https://r2/a?sig=1" });
    const merged = mergeGalleryChanges([before], [item("a", 1, { thumbSrc: "https://r2/a-thumb?sig=2" })], [], false);
    expect(merged[0].thumbSrc).toBe("https://r2/a-thumb?sig=2");
  });

  it("returns the same list when nothing changed, so React skips the render", () => {
    const current = [item("a", 1)];
    expect(mergeGalleryChanges(current, [], [], false)).toBe(current);
  });
});
