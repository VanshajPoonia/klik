"use client";

import { useEffect, useRef } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";
import { selectClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ColorField, NumberField, PanelSection, Segmented } from "@/components/print/fields";
import type { PrintDoc, PrintElement, QrElement, TextElement } from "@/lib/print/doc";
import { displayUrl } from "@/lib/print/draw";
import type { Alignment, LayerMove } from "@/lib/print/edit";
import { PRINT_FONTS, findFont, nearestWeight } from "@/lib/print/fonts";
import { MIN_QR_MM, qrCodeMm } from "@/lib/print/guardrails";
import { PRINT_ICONS, PRINT_ICON_KEYS } from "@/lib/print/icons";
import { describeSize, findPreset, type DesignSize } from "@/lib/print/presets";
import { QR_STYLES } from "@/lib/qr-shapes";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

const QR_STYLE_LABELS: Record<(typeof QR_STYLES)[number], string> = { classic: "Classic", dots: "Dots", rounded: "Rounded" };

export interface PanelAssets {
  id: string;
  url: string;
  width: number;
  height: number;
}

/**
 * QR-4b: the right-hand panel. With nothing selected it is the page; with one
 * element, everything about it; with several, what they have in common:
 * alignment, order, and deleting.
 */
export function PropertiesPanel({
  doc,
  size,
  selection,
  swatches,
  eventName,
  url,
  qrModules,
  focusText,
  onFocusTextDone,
  onPatch,
  onPage,
  onAlign,
  onDistribute,
  onReorder,
  onDuplicate,
  onDelete,
  onPickBackground,
  assets,
}: {
  doc: PrintDoc;
  size: DesignSize;
  selection: PrintElement[];
  swatches: string[];
  eventName: string;
  url: string;
  qrModules: number;
  /** An element whose words were double-clicked on the page. */
  focusText: string | null;
  onFocusTextDone: () => void;
  onPatch: (id: string, patch: Partial<PrintElement>, key?: string) => void;
  onPage: (patch: Partial<PrintDoc["background"]>, key?: string) => void;
  onAlign: (edge: Alignment) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onReorder: (move: LayerMove) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPickBackground: () => void;
  assets: PanelAssets[];
}) {
  const textArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusText && textArea.current) {
      textArea.current.focus();
      textArea.current.select();
      onFocusTextDone();
    }
  }, [focusText, onFocusTextDone]);

  if (selection.length === 0) {
    const preset = findPreset(size.preset);
    const backgroundAsset = doc.background.assetId ? assets.find((asset) => asset.id === doc.background.assetId) : null;
    return (
      <div>
        <PanelSection title="Page">
          <p className="text-xs text-paper">
            {preset?.label ?? "Custom size"} · {describeSize(size)}
          </p>
          <p className="text-[11px] text-muted">
            {size.bleedMm > 0
              ? `The dimmed strip is the ${size.bleedMm} mm bleed: colour and photos should run into it, and it is cut off. Keep words and codes inside the dashed line.`
              : preset?.pixels
                ? `Exported at ${preset.pixels.width} × ${preset.pixels.height} pixels for a screen.`
                : "Printed without bleed. Keep words and codes inside the dashed line."}
          </p>
        </PanelSection>
        <PanelSection title="Background">
          <ColorField label="Colour" value={doc.background.color} swatches={swatches} onChange={(color) => color && onPage({ color }, "background-color")} />
          <div className="flex flex-wrap items-center gap-2">
            {backgroundAsset && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={backgroundAsset.url} alt="" className="h-12 w-12 rounded-md border border-canvas-line object-cover" />
            )}
            <button type="button" onClick={onPickBackground} className="min-h-9 rounded-full border border-canvas-line px-3 text-xs text-paper hover:border-volt/50">
              {doc.background.assetId ? "Change photo" : "Use a photo"}
            </button>
            {doc.background.assetId && (
              <button type="button" onClick={() => onPage({ assetId: null })} className="min-h-9 rounded-full px-3 text-xs text-muted hover:text-paper">
                Remove photo
              </button>
            )}
          </div>
        </PanelSection>
        <PanelSection title="Tips">
          <ul className="space-y-1.5 text-[11px] text-muted">
            <li>Drag from a ruler to place a guide; drag it off the page to remove it.</li>
            <li>Hold Space and drag to move around; pinch or Ctrl and scroll to zoom.</li>
            <li>Hold Alt while dragging to place things without snapping.</li>
            <li>Shift-click or drag across the page to select several.</li>
          </ul>
        </PanelSection>
      </div>
    );
  }

  const several = selection.length > 1;
  const single = several ? null : selection[0];
  const key = (field: string) => `${single?.id ?? "many"}:${field}`;
  const patch = (changes: Partial<PrintElement>, field: string) => single && onPatch(single.id, changes, key(field));
  const locked = single?.locked ?? false;

  return (
    <div>
      <PanelSection title={several ? `${selection.length} selected` : labelFor(single!)}>
        <div className="flex flex-wrap gap-0.5">
          <IconButton label={several ? "Align left edges" : "Align to the left of the page"} onClick={() => onAlign("left")}>
            <AlignStartVertical className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Centre across" onClick={() => onAlign("center")}>
            <AlignCenterVertical className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Align right" onClick={() => onAlign("right")}>
            <AlignEndVertical className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Align top" onClick={() => onAlign("top")}>
            <AlignStartHorizontal className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Centre up and down" onClick={() => onAlign("middle")}>
            <AlignCenterHorizontal className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Align bottom" onClick={() => onAlign("bottom")}>
            <AlignEndHorizontal className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          {selection.length >= 3 && (
            <>
              <IconButton label="Space evenly across" onClick={() => onDistribute("horizontal")}>
                <AlignHorizontalSpaceAround className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton label="Space evenly up and down" onClick={() => onDistribute("vertical")}>
                <AlignVerticalSpaceAround className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-0.5 border-t border-canvas-line pt-2">
          <IconButton label="Bring to front" onClick={() => onReorder("front")}>
            <ArrowUpToLine className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Bring forward" onClick={() => onReorder("forward")}>
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Send backward" onClick={() => onReorder("backward")}>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Send to back" onClick={() => onReorder("back")}>
            <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Duplicate" onClick={onDuplicate}>
            <Copy className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          {single && (
            <IconButton label={locked ? "Unlock" : "Lock in place"} onClick={() => onPatch(single.id, { locked: !locked })}>
              {locked ? <Lock className="h-4 w-4 text-volt" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
            </IconButton>
          )}
          <IconButton label="Delete" tone="danger" onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </PanelSection>

      {single && (
        <PanelSection title="Position and size">
          {locked && <p className="text-[11px] text-muted">Locked in place. Unlock it to move or resize it.</p>}
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Across" suffix="mm" value={single.x} disabled={locked} onCommit={(x) => patch({ x }, "x")} />
            <NumberField label="Down" suffix="mm" value={single.y} disabled={locked} onCommit={(y) => patch({ y }, "y")} />
            <NumberField
              label="Width"
              suffix="mm"
              min={1}
              value={single.width}
              disabled={locked}
              onCommit={(width) => patch(single.type === "qr" ? { width, height: width } : { width }, "width")}
            />
            <NumberField
              label="Height"
              suffix="mm"
              min={1}
              value={single.height}
              disabled={locked || single.type === "text" || single.type === "qr" || single.type === "line"}
              onCommit={(height) => patch({ height }, "height")}
            />
            <NumberField label="Turn" suffix="°" min={-360} max={360} value={single.rotation} disabled={locked} onCommit={(rotation) => patch({ rotation }, "rotation")} />
            <NumberField
              label="Opacity"
              suffix="%"
              min={0}
              max={100}
              decimals={0}
              value={single.opacity * 100}
              onCommit={(value) => patch({ opacity: value / 100 }, "opacity")}
            />
          </div>
        </PanelSection>
      )}

      {single?.type === "text" && <TextSection element={single} textArea={textArea} swatches={swatches} eventName={eventName} url={url} patch={patch} />}
      {single?.type === "qr" && <QrSection element={single} swatches={swatches} url={url} qrModules={qrModules} patch={patch} />}

      {single?.type === "image" && (
        <PanelSection title="Photo">
          <Segmented
            label="Fit"
            value={single.fit}
            options={[
              { value: "cover", label: "Fill the frame" },
              { value: "contain", label: "Show it whole" },
            ]}
            onChange={(fit) => patch({ fit }, "fit")}
          />
          <NumberField label="Corner rounding" suffix="mm" min={0} value={single.radius} onCommit={(radius) => patch({ radius }, "radius")} />
        </PanelSection>
      )}

      {(single?.type === "rect" || single?.type === "ellipse") && (
        <PanelSection title="Shape">
          <ColorField label="Fill" value={single.fill} allowNone swatches={swatches} onChange={(fill) => patch({ fill }, "fill")} />
          <ColorField label="Outline" value={single.stroke} allowNone swatches={swatches} onChange={(stroke) => patch({ stroke, strokeWidth: stroke && single.strokeWidth === 0 ? 0.5 : single.strokeWidth }, "stroke")} />
          {single.stroke && (
            <NumberField label="Outline thickness" suffix="mm" min={0} max={100} step={0.1} decimals={2} value={single.strokeWidth} onCommit={(strokeWidth) => patch({ strokeWidth }, "strokeWidth")} />
          )}
          {single.type === "rect" && (
            <NumberField label="Corner rounding" suffix="mm" min={0} value={single.radius} onCommit={(radius) => patch({ radius }, "radius")} />
          )}
        </PanelSection>
      )}

      {single?.type === "line" && (
        <PanelSection title="Line">
          <ColorField label="Colour" value={single.stroke} swatches={swatches} onChange={(stroke) => stroke && patch({ stroke }, "stroke")} />
          <NumberField label="Thickness" suffix="mm" min={0.05} max={100} step={0.1} decimals={2} value={single.strokeWidth} onCommit={(strokeWidth) => patch({ strokeWidth }, "strokeWidth")} />
          <Segmented
            label="Style"
            value={single.dashed ? "dashed" : "solid"}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
            ]}
            onChange={(style) => patch({ dashed: style === "dashed" }, "dashed")}
          />
        </PanelSection>
      )}

      {single?.type === "icon" && (
        <PanelSection title="Icon">
          <div className="grid grid-cols-5 gap-1">
            {PRINT_ICON_KEYS.map((icon) => (
              <button
                key={icon}
                type="button"
                title={PRINT_ICONS[icon].label}
                aria-label={PRINT_ICONS[icon].label}
                aria-pressed={single.icon === icon}
                onClick={() => patch({ icon }, "icon")}
                className={`flex h-10 items-center justify-center rounded-lg border ${single.icon === icon ? "border-volt" : "border-canvas-line"} text-paper`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                  <path d={PRINT_ICONS[icon].path} />
                </svg>
              </button>
            ))}
          </div>
          <ColorField label="Colour" value={single.color} swatches={swatches} onChange={(color) => color && patch({ color }, "color")} />
        </PanelSection>
      )}
    </div>
  );
}

function labelFor(element: PrintElement): string {
  if (element.name) return element.name;
  switch (element.type) {
    case "qr":
      return "QR code";
    case "text":
      return "Text";
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

function TextSection({
  element,
  textArea,
  swatches,
  eventName,
  url,
  patch,
}: {
  element: TextElement;
  textArea: React.RefObject<HTMLTextAreaElement | null>;
  swatches: string[];
  eventName: string;
  url: string;
  patch: (changes: Partial<PrintElement>, field: string) => void;
}) {
  const font = findFont(element.font);
  return (
    <PanelSection title="Words">
      {element.bind ? (
        <div className="rounded-lg border border-canvas-line bg-canvas p-2.5 text-xs">
          <p className="text-paper">{element.bind === "eventName" ? eventName : displayUrl(url)}</p>
          <p className="mt-1 text-[11px] text-muted">
            {element.bind === "eventName"
              ? "Shows the event's name, and changes if you rename the event."
              : "Shows the gallery's address, and changes if the address does."}
          </p>
          <button
            type="button"
            onClick={() => patch({ bind: null, text: element.bind === "eventName" ? eventName : displayUrl(url) }, "unbind")}
            className="mt-2 text-[11px] text-volt hover:text-paper"
          >
            Write your own words instead
          </button>
        </div>
      ) : (
        <textarea
          ref={textArea}
          value={element.text}
          rows={3}
          maxLength={600}
          onChange={(event) => patch({ text: event.target.value }, "text")}
          aria-label="The words"
          className="w-full resize-y rounded-lg border border-canvas-line bg-canvas px-2.5 py-2 text-sm text-paper focus:border-volt/60 focus:outline-none focus:ring-1 focus:ring-volt/60"
        />
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted">Typeface</span>
        <select
          value={element.font}
          onChange={(event) => {
            const next = findFont(event.target.value);
            patch({ font: next.key, weight: nearestWeight(next, element.weight), italic: element.italic && next.italic }, "font");
          }}
          className={`${selectClass} py-1.5 text-xs`}
        >
          {PRINT_FONTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Size" suffix="pt" min={2} max={800} decimals={1} value={element.size} onCommit={(size) => patch({ size }, "size")} />
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted">Weight</span>
          <select value={nearestWeight(font, element.weight)} onChange={(event) => patch({ weight: Number(event.target.value) }, "weight")} className={`${selectClass} py-1.5 text-xs`}>
            {font.weights.map((weight) => (
              <option key={weight} value={weight}>
                {WEIGHT_NAMES[weight] ?? weight}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Line spacing" min={0.6} max={3} step={0.05} decimals={2} value={element.lineHeight} onCommit={(lineHeight) => patch({ lineHeight }, "lineHeight")} />
        <NumberField label="Letter spacing" min={-200} max={1000} step={10} decimals={0} value={element.tracking} onCommit={(tracking) => patch({ tracking }, "tracking")} />
      </div>
      <Segmented
        label="Alignment"
        value={element.align}
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ]}
        onChange={(align) => patch({ align }, "align")}
      />
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={element.uppercase}
          onClick={() => patch({ uppercase: !element.uppercase }, "uppercase")}
          className={`min-h-8 flex-1 rounded-lg border text-xs ${element.uppercase ? "border-volt text-volt" : "border-canvas-line text-muted hover:text-paper"}`}
        >
          CAPITALS
        </button>
        <button
          type="button"
          aria-pressed={element.italic}
          disabled={!font.italic}
          title={font.italic ? undefined : `${font.label} has no italic`}
          onClick={() => patch({ italic: !element.italic }, "italic")}
          className={`min-h-8 flex-1 rounded-lg border text-xs italic disabled:opacity-40 ${element.italic ? "border-volt text-volt" : "border-canvas-line text-muted hover:text-paper"}`}
        >
          Italic
        </button>
      </div>
      <ColorField label="Colour" value={element.color} swatches={swatches} onChange={(color) => color && patch({ color }, "color")} />
    </PanelSection>
  );
}

function QrSection({
  element,
  swatches,
  url,
  qrModules,
  patch,
}: {
  element: QrElement;
  swatches: string[];
  url: string;
  qrModules: number;
  patch: (changes: Partial<PrintElement>, field: string) => void;
}) {
  const codeMm = qrCodeMm(element, qrModules);
  return (
    <PanelSection title="QR code">
      <p className="text-[11px] text-muted">
        Opens {displayUrl(url)}. If the gallery&apos;s address changes, every design follows it.
      </p>
      <p className={`text-xs ${codeMm < MIN_QR_MM ? "text-amber-400" : "text-paper"}`}>
        Prints {(codeMm / 10).toFixed(1)} cm across{codeMm < MIN_QR_MM ? ". Make it at least 2.5 cm so it scans." : "."}
      </p>
      <Segmented
        label="Style"
        value={element.style}
        options={QR_STYLES.map((style) => ({ value: style, label: QR_STYLE_LABELS[style] }))}
        onChange={(style) => patch({ style }, "style")}
      />
      <ColorField label="Code" value={element.foreground} swatches={swatches} onChange={(foreground) => foreground && patch({ foreground }, "foreground")} />
      <ColorField
        label="Behind the code"
        value={element.background}
        allowNone
        noneLabel="See-through"
        swatches={swatches}
        onChange={(background) => patch({ background }, "background")}
      />
      <p className="text-[11px] text-muted">Dark on light scans best. The quiet border around the code is always kept.</p>
    </PanelSection>
  );
}
