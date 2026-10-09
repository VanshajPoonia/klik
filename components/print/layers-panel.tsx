"use client";

import { Circle, Eye, EyeOff, Image as ImageIcon, Lock, Minus, QrCode, Shapes, Square, Type, Unlock } from "lucide-react";
import type { PrintElement } from "@/lib/print/doc";
import { PRINT_ICONS } from "@/lib/print/icons";

const ICONS = { qr: QrCode, text: Type, image: ImageIcon, rect: Square, ellipse: Circle, line: Minus, icon: Shapes } as const;

function describe(element: PrintElement): string {
  if (element.name) return element.name;
  switch (element.type) {
    case "text":
      return element.bind === "eventName" ? "Event name" : element.bind === "url" ? "Gallery address" : element.text.trim().slice(0, 40) || "Text";
    case "qr":
      return "QR code";
    case "image":
      return "Photo";
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Circle";
    case "line":
      return "Line";
    case "icon":
      return PRINT_ICONS[element.icon].label;
  }
}

/**
 * QR-4b: every element, top of the stack first, the way a layer list reads.
 * Hide something to take it out of print without deleting it; lock it so a
 * stray drag cannot move it.
 */
export function LayersPanel({
  elements,
  selection,
  onSelect,
  onToggle,
}: {
  elements: PrintElement[];
  selection: string[];
  onSelect: (ids: string[], additive: boolean) => void;
  onToggle: (id: string, field: "hidden" | "locked") => void;
}) {
  if (elements.length === 0) {
    return <p className="px-4 py-6 text-xs text-muted">Nothing on the page yet. Add something from the other tab.</p>;
  }
  return (
    <ul className="py-2">
      {[...elements].reverse().map((element) => {
        const Icon = ICONS[element.type];
        const active = selection.includes(element.id);
        return (
          <li key={element.id} className={`flex items-center gap-1 px-2 ${active ? "bg-canvas-line/60" : ""}`}>
            <button
              type="button"
              onClick={(event) => onSelect([element.id], event.shiftKey || event.metaKey)}
              aria-pressed={active}
              className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-xs ${element.hidden ? "text-muted" : "text-paper"}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">{describe(element)}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggle(element.id, "locked")}
              aria-label={element.locked ? `Unlock ${describe(element)}` : `Lock ${describe(element)}`}
              className={`flex h-9 w-8 items-center justify-center rounded ${element.locked ? "text-volt" : "text-muted hover:text-paper"}`}
            >
              {element.locked ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : <Unlock className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => onToggle(element.id, "hidden")}
              aria-label={element.hidden ? `Show ${describe(element)}` : `Hide ${describe(element)}`}
              className="flex h-9 w-8 items-center justify-center rounded text-muted hover:text-paper"
            >
              {element.hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
