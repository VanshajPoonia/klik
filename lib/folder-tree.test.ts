import { describe, expect, it } from "vitest";
import {
  canMoveFolder,
  canNestIn,
  childrenOf,
  descendantIds,
  flattenFolders,
  folderLabel,
  folderPath,
  inFolder,
  subtreeHeight,
} from "./folder-tree";

// Ceremony > Vows > Rings, Ceremony > Walk, Party, and Old, whose parent is gone.
const folders = [
  { id: "party", name: "Party", parentId: null, position: 2 },
  { id: "ceremony", name: "Ceremony", parentId: null, position: 1 },
  { id: "walk", name: "Walk", parentId: "ceremony", position: 2 },
  { id: "vows", name: "Vows", parentId: "ceremony", position: 1 },
  { id: "rings", name: "Rings", parentId: "vows", position: 1 },
  { id: "old", name: "Old", parentId: "deleted-parent", position: 0 },
];

describe("folder tree", () => {
  it("orders children by position, and lifts a folder whose parent is gone to the top", () => {
    expect(childrenOf(folders, null).map((folder) => folder.id)).toEqual(["old", "ceremony", "party"]);
    expect(childrenOf(folders, "ceremony").map((folder) => folder.id)).toEqual(["vows", "walk"]);
  });

  it("walks a path from the top, and names it", () => {
    expect(folderPath(folders, "rings").map((folder) => folder.id)).toEqual(["ceremony", "vows", "rings"]);
    expect(folderLabel(folders, "rings")).toBe("Ceremony / Vows / Rings");
    expect(folderPath(folders, "nope")).toEqual([]);
  });

  it("survives a cycle in data it was handed, rather than looping", () => {
    const looped = [
      { id: "a", name: "A", parentId: "b", position: 0 },
      { id: "b", name: "B", parentId: "a", position: 0 },
    ];
    expect(folderPath(looped, "a")).toHaveLength(2);
    expect([...descendantIds(looped, "a")].sort()).toEqual(["a", "b"]);
  });

  it("finds everything beneath a folder, and how tall it is", () => {
    expect([...descendantIds(folders, "ceremony")].sort()).toEqual(["ceremony", "rings", "vows", "walk"]);
    expect(subtreeHeight(folders, "ceremony")).toBe(3);
    expect(subtreeHeight(folders, "party")).toBe(1);
  });

  it("refuses a move into itself, beneath itself, or past three levels", () => {
    expect(canMoveFolder(folders, "ceremony", "ceremony")).toBe("self");
    expect(canMoveFolder(folders, "ceremony", "rings")).toBe("cycle");
    expect(canMoveFolder(folders, "vows", "party")).toBeNull();
    expect(canMoveFolder(folders, "ceremony", "party")).toBe("too_deep");
    expect(canMoveFolder(folders, "party", "vows")).toBeNull();
    expect(canMoveFolder(folders, "party", "rings")).toBe("too_deep");
    expect(canMoveFolder(folders, "party", "missing")).toBe("unknown_parent");
    expect(canMoveFolder(folders, "rings", null)).toBeNull();
  });

  it("allows a new folder only where it stays within three levels", () => {
    expect(canNestIn(folders, null)).toBe(true);
    expect(canNestIn(folders, "vows")).toBe(true);
    expect(canNestIn(folders, "rings")).toBe(false);
  });

  it("flattens in tree order with depths, for a select", () => {
    expect(flattenFolders(folders).map((folder) => `${folder.depth}:${folder.id}`)).toEqual([
      "1:old",
      "1:ceremony",
      "2:vows",
      "3:rings",
      "2:walk",
      "1:party",
    ]);
  });

  it("filters items to a folder with or without what is beneath it, and finds the unfiled", () => {
    const items = [
      { id: "1", albumId: "ceremony" },
      { id: "2", albumId: "rings" },
      { id: "3", albumId: null },
      { id: "4", albumId: "in-the-trash" },
      { id: "5", albumId: "party" },
    ];
    expect(inFolder(items, folders, "ceremony").map((item) => item.id)).toEqual(["1", "2"]);
    expect(inFolder(items, folders, "ceremony", { deep: false }).map((item) => item.id)).toEqual(["1"]);
    expect(inFolder(items, folders, null).map((item) => item.id)).toEqual(["3", "4"]);
  });
});
