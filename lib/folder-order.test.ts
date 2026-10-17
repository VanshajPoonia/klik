import { describe, expect, it } from "vitest";
import { inFolderOrder, moveItem } from "./folder-order";

describe("inFolderOrder", () => {
  it("puts placed photos first by place, and keeps the rest in the order they came", () => {
    const items = [
      { id: "new", folderPosition: null },
      { id: "b", folderPosition: 1 },
      { id: "older", folderPosition: null },
      { id: "a", folderPosition: 0 },
    ];
    expect(inFolderOrder(items).map((item) => item.id)).toEqual(["a", "b", "new", "older"]);
  });

  it("leaves a folder nobody arranged exactly as it was", () => {
    const items = [{ id: "x" }, { id: "y", folderPosition: null }];
    expect(inFolderOrder(items)).toBe(items);
  });
});

describe("moveItem", () => {
  it("moves one item to a new place and keeps the others in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});
