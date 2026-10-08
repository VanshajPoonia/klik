import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { media } from "./schema";
import { MEDIA_OBJECT_COLUMNS, mediaObjectKeys } from "./media-objects";

describe("MEDIA_OBJECT_COLUMNS", () => {
  /**
   * The structural guard, in the same spirit as the SEC-10 test in
   * lib/events.test.ts. Adding a rendition column without listing it here
   * would make erasure leave those bytes behind, silently, with every other
   * test still green.
   */
  it("lists every column on media that names an object in the bucket", () => {
    const pathnameColumns = Object.entries(getTableColumns(media))
      .filter(([, column]) => column.name.endsWith("_pathname"))
      .map(([key]) => key)
      .sort();
    expect(Object.keys(MEDIA_OBJECT_COLUMNS).sort()).toEqual(pathnameColumns);
  });
});

describe("mediaObjectKeys", () => {
  it("collects every object a row owns and drops the ones it lacks", () => {
    expect(
      mediaObjectKeys([
        { blobPathname: "a.mov", posterPathname: "a-poster.jpg", thumbPathname: "a-thumb.jpg" },
        { blobPathname: "b.jpg", posterPathname: null, thumbPathname: null },
      ]).sort(),
    ).toEqual(["a-poster.jpg", "a-thumb.jpg", "a.mov", "b.jpg"]);
  });

  it("never returns the same key twice", () => {
    expect(mediaObjectKeys([{ blobPathname: "x" }, { blobPathname: "x" }])).toEqual(["x"]);
  });
});
