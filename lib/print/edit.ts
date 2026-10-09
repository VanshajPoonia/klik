import { elementBox, elementId, type Box, type PrintDoc, type PrintElement } from "./doc";
import type { DesignSize } from "./presets";

/**
 * QR-4b: the studio's edits, as pure functions from one design to the next.
 * The editor keeps every state it has been in for undo, so none of these
 * change what they are given.
 */

export function updateElement(doc: PrintDoc, id: string, patch: Partial<PrintElement>): PrintDoc {
  return {
    ...doc,
    elements: doc.elements.map((element) => (element.id === id ? ({ ...element, ...patch } as PrintElement) : element)),
  };
}

export function updateElements(doc: PrintDoc, change: (element: PrintElement) => PrintElement | null): PrintDoc {
  return {
    ...doc,
    elements: doc.elements.map((element) => change(element) ?? element),
  };
}

export function addElements(doc: PrintDoc, elements: PrintElement[]): PrintDoc {
  return { ...doc, elements: [...doc.elements, ...elements] };
}

export function removeElements(doc: PrintDoc, ids: ReadonlySet<string>): PrintDoc {
  return { ...doc, elements: doc.elements.filter((element) => !ids.has(element.id) || element.locked) };
}

/** Copies, offset so they do not sit exactly on the originals, above them. */
export function duplicateElements(doc: PrintDoc, ids: ReadonlySet<string>, offsetMm = 5): { doc: PrintDoc; ids: string[] } {
  const copies = doc.elements
    .filter((element) => ids.has(element.id))
    .map((element) => ({ ...element, id: elementId(), x: element.x + offsetMm, y: element.y + offsetMm, locked: false }) as PrintElement);
  return { doc: addElements(doc, copies), ids: copies.map((copy) => copy.id) };
}

export type LayerMove = "forward" | "backward" | "front" | "back";

/** Moves the selected elements in the stacking order, keeping their own order. */
export function reorder(doc: PrintDoc, ids: ReadonlySet<string>, move: LayerMove): PrintDoc {
  const elements = [...doc.elements];
  if (move === "front" || move === "back") {
    const chosen = elements.filter((element) => ids.has(element.id));
    const rest = elements.filter((element) => !ids.has(element.id));
    return { ...doc, elements: move === "front" ? [...rest, ...chosen] : [...chosen, ...rest] };
  }
  if (move === "forward") {
    for (let index = elements.length - 2; index >= 0; index -= 1) {
      if (ids.has(elements[index].id) && !ids.has(elements[index + 1].id)) {
        [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
      }
    }
  } else {
    for (let index = 1; index < elements.length; index += 1) {
      if (ids.has(elements[index].id) && !ids.has(elements[index - 1].id)) {
        [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
      }
    }
  }
  return { ...doc, elements };
}

/** The box around several elements, as drawn. */
export function unionBox(elements: Array<Pick<PrintElement, "x" | "y" | "width" | "height" | "rotation">>): Box | null {
  if (elements.length === 0) return null;
  const boxes = elements.map(elementBox);
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Lines the selection up: one element against the page, several against the
 * box around them all, the way every layout tool does it.
 */
export function align(doc: PrintDoc, ids: ReadonlySet<string>, edge: Alignment, size: Pick<DesignSize, "widthMm" | "heightMm">): PrintDoc {
  const chosen = doc.elements.filter((element) => ids.has(element.id) && !element.locked);
  if (chosen.length === 0) return doc;
  const frame: Box =
    chosen.length === 1 ? { left: 0, top: 0, right: size.widthMm, bottom: size.heightMm } : unionBox(chosen)!;
  return updateElements(doc, (element) => {
    if (!ids.has(element.id) || element.locked) return null;
    const box = elementBox(element);
    const dx =
      edge === "left"
        ? frame.left - box.left
        : edge === "right"
          ? frame.right - box.right
          : edge === "center"
            ? (frame.left + frame.right) / 2 - (box.left + box.right) / 2
            : 0;
    const dy =
      edge === "top"
        ? frame.top - box.top
        : edge === "bottom"
          ? frame.bottom - box.bottom
          : edge === "middle"
            ? (frame.top + frame.bottom) / 2 - (box.top + box.bottom) / 2
            : 0;
    return { ...element, x: round(element.x + dx), y: round(element.y + dy) } as PrintElement;
  });
}

/** Even gaps between three or more elements, keeping the outer two where they are. */
export function distribute(doc: PrintDoc, ids: ReadonlySet<string>, axis: "horizontal" | "vertical"): PrintDoc {
  const chosen = doc.elements
    .filter((element) => ids.has(element.id) && !element.locked)
    .map((element) => ({ element, box: elementBox(element) }))
    .sort((a, b) => (axis === "horizontal" ? a.box.left - b.box.left : a.box.top - b.box.top));
  if (chosen.length < 3) return doc;
  const start = axis === "horizontal" ? chosen[0].box.left : chosen[0].box.top;
  const end = axis === "horizontal" ? chosen[chosen.length - 1].box.right : chosen[chosen.length - 1].box.bottom;
  const occupied = chosen.reduce(
    (total, { box }) => total + (axis === "horizontal" ? box.right - box.left : box.bottom - box.top),
    0,
  );
  const gap = (end - start - occupied) / (chosen.length - 1);
  const moves = new Map<string, number>();
  let cursor = start;
  for (const { element, box } of chosen) {
    const at = axis === "horizontal" ? box.left : box.top;
    moves.set(element.id, cursor - at);
    cursor += (axis === "horizontal" ? box.right - box.left : box.bottom - box.top) + gap;
  }
  return updateElements(doc, (element) => {
    const move = moves.get(element.id);
    if (move === undefined) return null;
    return (axis === "horizontal" ? { ...element, x: round(element.x + move) } : { ...element, y: round(element.y + move) }) as PrintElement;
  });
}

/** Millimetres to a tenth of a micron: enough, and keeps stored numbers short. */
export function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface SnapTargets {
  x: number[];
  y: number[];
}

/**
 * Where a box being dragged should snap to: the nearest page edge, centre,
 * safe line, guide or edge or centre of another element, within `threshold`
 * millimetres, separately on each axis. Returns the correction to apply and the
 * lines it snapped to, for drawing.
 */
export function snapBox(box: Box, targets: SnapTargets, threshold: number): { dx: number; dy: number; x: number | null; y: number | null } {
  const nearest = (points: number[], lines: number[]) => {
    let best: { delta: number; line: number } | null = null;
    for (const point of points) {
      for (const line of lines) {
        const delta = line - point;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
      }
    }
    return best;
  };
  const horizontal = nearest([box.left, (box.left + box.right) / 2, box.right], targets.x);
  const vertical = nearest([box.top, (box.top + box.bottom) / 2, box.bottom], targets.y);
  return { dx: horizontal?.delta ?? 0, dy: vertical?.delta ?? 0, x: horizontal?.line ?? null, y: vertical?.line ?? null };
}

/** Everything a selection can snap to, from the page and everything else on it. */
export function snapTargets(doc: PrintDoc, moving: ReadonlySet<string>, size: Pick<DesignSize, "widthMm" | "heightMm">, safe: number): SnapTargets {
  const x = [0, size.widthMm / 2, size.widthMm, safe, size.widthMm - safe, ...doc.guides.x];
  const y = [0, size.heightMm / 2, size.heightMm, safe, size.heightMm - safe, ...doc.guides.y];
  for (const element of doc.elements) {
    if (moving.has(element.id) || element.hidden) continue;
    const box = elementBox(element);
    x.push(box.left, (box.left + box.right) / 2, box.right);
    y.push(box.top, (box.top + box.bottom) / 2, box.bottom);
  }
  return { x, y };
}
