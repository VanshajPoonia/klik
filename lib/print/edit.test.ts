import { describe, expect, it } from "vitest";
import { emptyDoc, type PrintDoc, type PrintElement } from "./doc";
import { align, distribute, duplicateElements, removeElements, reorder, snapBox, snapTargets } from "./edit";
import { withPngDpi } from "./export";

const box = (id: string, x: number, y: number, width = 10, height = 10, extra: Partial<PrintElement> = {}): PrintElement =>
  ({ id, type: "rect", x, y, width, height, rotation: 0, opacity: 1, fill: "#000000", stroke: null, strokeWidth: 0, radius: 0, ...extra }) as PrintElement;

const doc = (elements: PrintElement[]): PrintDoc => ({ ...emptyDoc(), elements });
const A4 = { widthMm: 210, heightMm: 297 };
const ids = (...values: string[]) => new Set(values);

describe("editing a design", () => {
  it("aligns one element to the page and several to their own box", () => {
    expect(align(doc([box("a", 30, 40)]), ids("a"), "center", A4).elements[0].x).toBe(100);
    const lined = align(doc([box("a", 30, 40), box("b", 80, 90, 20)]), ids("a", "b"), "right", A4);
    expect(lined.elements.map((element) => element.x)).toEqual([90, 80]);
  });

  it("leaves a locked element where it is", () => {
    const lined = align(doc([box("a", 30, 40, 10, 10, { locked: true }), box("b", 80, 90)]), ids("a", "b"), "left", A4);
    expect(lined.elements.map((element) => element.x)).toEqual([30, 0]);
  });

  it("spaces three or more evenly between the outer two", () => {
    const spaced = distribute(doc([box("a", 0, 0), box("b", 15, 0), box("c", 90, 0)]), ids("a", "b", "c"), "horizontal");
    expect(spaced.elements.map((element) => element.x)).toEqual([0, 45, 90]);
  });

  it("moves elements through the stack keeping their own order", () => {
    const stack = doc([box("a", 0, 0), box("b", 0, 0), box("c", 0, 0), box("d", 0, 0)]);
    const order = (value: PrintDoc) => value.elements.map((element) => element.id).join("");
    expect(order(reorder(stack, ids("a", "b"), "forward"))).toBe("cabd");
    expect(order(reorder(stack, ids("c"), "back"))).toBe("cabd");
    expect(order(reorder(stack, ids("a", "c"), "front"))).toBe("bdac");
    expect(order(reorder(stack, ids("d"), "backward"))).toBe("abdc");
  });

  it("duplicates above and offset, and never deletes a locked element", () => {
    const start = doc([box("a", 10, 10, 10, 10, { locked: true }), box("b", 50, 50)]);
    const copied = duplicateElements(start, ids("a"));
    expect(copied.doc.elements).toHaveLength(3);
    expect(copied.doc.elements[2]).toMatchObject({ x: 15, y: 15, locked: false });
    expect(removeElements(start, ids("a", "b")).elements.map((element) => element.id)).toEqual(["a"]);
  });

  it("snaps a dragged box to the page centre and to other elements, within the threshold only", () => {
    const page = doc([box("a", 0, 0), box("other", 150, 200, 20, 20)]);
    const targets = snapTargets(page, ids("a"), A4, 3);
    expect(snapBox({ left: 98, right: 108, top: 50, bottom: 60 }, targets, 2)).toMatchObject({ dx: 2, x: 105 });
    expect(snapBox({ left: 120, right: 149, top: 199, bottom: 207 }, targets, 2)).toMatchObject({ dx: 1, dy: 1 });
    expect(snapBox({ left: 60, right: 70, top: 60, bottom: 70 }, targets, 1)).toMatchObject({ dx: 0, dy: 0, x: null, y: null });
  });
});

describe("a PNG's resolution", () => {
  it("is written as a pHYs chunk right after the header", () => {
    const png = new Uint8Array(8 + 25 + 12);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = withPngDpi(png, 300);
    expect(out.length).toBe(png.length + 21);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe("pHYs");
    const view = new DataView(out.buffer);
    expect(view.getUint32(41)).toBe(11811);
    expect(out[49]).toBe(1);
  });
});
