"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type Konva from "konva";
import { Group, Layer, Line, Rect, Shape, Stage, Transformer } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { boxesOverlap, elementBox, type Box, type PrintDoc, type PrintElement } from "@/lib/print/doc";
import { drawBackground, drawElement, type DrawEnv } from "@/lib/print/draw";
import { round, snapBox, snapTargets, unionBox, type SnapTargets } from "@/lib/print/edit";
import { SAFE_MARGIN_MM, type DesignSize } from "@/lib/print/presets";

/**
 * QR-4b: the studio's page. Konva does the pointer work (selection, dragging,
 * the resize and rotate handles); every element draws itself through the same
 * `drawElement` the export uses, from inside its shape, so the page here and
 * the PDF cannot disagree.
 *
 * The page is laid out in millimetres inside one scaled group, so a stored
 * position is exactly where a thing is drawn. Wheel pans, pinch or Cmd/Ctrl
 * with the wheel zooms about the pointer, Space or the middle button drags the
 * view, and Alt held while dragging switches snapping off.
 */

export interface CanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Pixels per millimetre on screen. */
  scale: number;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const RULER = 20;
const MIN_SCALE = 0.15;
const MAX_SCALE = 40;
const SNAP_PX = 6;

/** A colour token as this page has it, with the value it ships with as fallback. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/** The native context Konva hands a shape, where `drawElement` draws. */
const nativeContext = (context: Konva.Context) => (context as unknown as { _context: CanvasRenderingContext2D })._context;

function ElementShape({
  element,
  env,
  draggable,
  onPointerDown,
  onDragStart,
  onDragMove,
  onDragEnd,
  onOpen,
}: {
  element: PrintElement;
  env: DrawEnv;
  draggable: boolean;
  onPointerDown: (event: KonvaEventObject<MouseEvent | TouchEvent>, element: PrintElement) => void;
  onDragStart: (event: KonvaEventObject<DragEvent>, element: PrintElement) => void;
  onDragMove: (event: KonvaEventObject<DragEvent>) => void;
  onDragEnd: () => void;
  onOpen: (element: PrintElement) => void;
}) {
  return (
    <Shape
      id={element.id}
      name="element"
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      // Never drawn: it only makes the shape hittable, which Konva decides by fill.
      fill="transparent"
      perfectDrawEnabled={false}
      draggable={draggable}
      sceneFunc={(context) => drawElement(nativeContext(context), element, env)}
      hitFunc={(context, shape) => {
        context.beginPath();
        context.rect(0, 0, element.width, element.height);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      onMouseDown={(event) => onPointerDown(event, element)}
      onTouchStart={(event) => onPointerDown(event, element)}
      onDragStart={(event) => onDragStart(event, element)}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDblClick={() => onOpen(element)}
      onDblTap={() => onOpen(element)}
    />
  );
}

function Ruler({
  axis,
  view,
  length,
  onStartGuide,
}: {
  axis: "x" | "y";
  view: View;
  length: number;
  onStartGuide: (axis: "x" | "y", event: React.PointerEvent) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const width = axis === "x" ? length : RULER;
    const height = axis === "x" ? RULER : length;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d")!;
    context.scale(ratio, ratio);
    context.fillStyle = token("--color-canvas-raised", "#121210");
    context.fillRect(0, 0, width, height);
    const steps: Array<[number, number]> = [
      [1, 10],
      [2, 10],
      [5, 50],
      [10, 50],
      [20, 100],
      [50, 500],
      [100, 500],
    ];
    const [minor, major] = steps.find(([step]) => step * view.scale >= 5) ?? steps[steps.length - 1];
    const origin = axis === "x" ? view.x : view.y;
    const first = Math.floor(-origin / view.scale / minor) * minor;
    const last = (length - origin) / view.scale;
    context.strokeStyle = token("--color-muted", "#8c8a80");
    context.fillStyle = token("--color-muted", "#8c8a80");
    context.font = "9px system-ui, sans-serif";
    context.lineWidth = 1;
    for (let mm = first; mm <= last; mm += minor) {
      const at = Math.round(origin + mm * view.scale) + 0.5;
      const isMajor = Math.abs(mm % major) < 0.001;
      const tick = isMajor ? 9 : 4;
      context.beginPath();
      if (axis === "x") {
        context.moveTo(at, RULER);
        context.lineTo(at, RULER - tick);
      } else {
        context.moveTo(RULER, at);
        context.lineTo(RULER - tick, at);
      }
      context.stroke();
      if (isMajor) {
        const label = String(Math.round(mm / 10));
        if (axis === "x") context.fillText(label, at + 2, 9);
        else {
          context.save();
          context.translate(9, at - 2);
          context.rotate(-Math.PI / 2);
          context.fillText(label, 0, 0);
          context.restore();
        }
      }
    }
    context.strokeStyle = token("--color-canvas-line", "#232320");
    context.beginPath();
    if (axis === "x") {
      context.moveTo(0, RULER - 0.5);
      context.lineTo(width, RULER - 0.5);
    } else {
      context.moveTo(RULER - 0.5, 0);
      context.lineTo(RULER - 0.5, height);
    }
    context.stroke();
  }, [axis, length, view]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      title={axis === "x" ? "Drag down to add a guide" : "Drag right to add a guide"}
      onPointerDown={(event) => onStartGuide(axis === "x" ? "y" : "x", event)}
      className={`absolute cursor-crosshair ${axis === "x" ? "left-5 top-0" : "left-0 top-5"}`}
      style={axis === "x" ? { width: length, height: RULER } : { width: RULER, height: length }}
    />
  );
}

export function StudioCanvas({
  ref,
  doc,
  size,
  env,
  redrawKey,
  selection,
  onSelect,
  onChange,
  panning,
  onOpenElement,
  onScaleChange,
}: {
  ref?: Ref<CanvasHandle>;
  doc: PrintDoc;
  size: DesignSize;
  env: DrawEnv;
  /** Bumped when fonts or images finish loading, so the page redraws with them. */
  redrawKey: number;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onChange: (doc: PrintDoc, key?: string) => void;
  /** Space is held: drag moves the view instead of things. */
  panning: boolean;
  onOpenElement: (id: string) => void;
  onScaleChange: (scale: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 40, y: 40 });
  const fitted = useRef(false);
  const [snapLines, setSnapLines] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [newGuide, setNewGuide] = useState<{ axis: "x" | "y"; value: number } | null>(null);
  const drag = useRef<{ ids: string[]; origins: Map<string, { x: number; y: number }>; box: Box; targets: SnapTargets; lead: string } | null>(null);
  const pan = useRef<{ x: number; y: number; view: View } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const anchor = useRef<string | null>(null);

  const colors = useMemo(
    () => ({
      desk: token("--color-canvas-line", "#232320"),
      volt: token("--color-volt", "#edee00"),
      muted: token("--color-muted", "#8c8a80"),
      paper: token("--color-paper", "#f3f1e9"),
    }),
    [],
  );

  const stageWidth = Math.max(0, box.width - RULER);
  const stageHeight = Math.max(0, box.height - RULER);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (stageWidth <= 0 || stageHeight <= 0) return;
    const pad = 48;
    const totalWidth = size.widthMm + size.bleedMm * 2;
    const totalHeight = size.heightMm + size.bleedMm * 2;
    const scale = Math.min((stageWidth - pad * 2) / totalWidth, (stageHeight - pad * 2) / totalHeight);
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    setView({ scale: clamped, x: (stageWidth - size.widthMm * clamped) / 2, y: (stageHeight - size.heightMm * clamped) / 2 });
  }, [size, stageHeight, stageWidth]);

  // Fitted once the space it has is known.
  useEffect(() => {
    if (!fitted.current && stageWidth > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, stageWidth]);

  useEffect(() => onScaleChange(view.scale), [onScaleChange, view.scale]);

  const zoomAround = useCallback((factor: number, point?: { x: number; y: number }) => {
    setView((current) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const at = point ?? { x: stageWidth / 2, y: stageHeight / 2 };
      return { scale, x: at.x - ((at.x - current.x) * scale) / current.scale, y: at.y - ((at.y - current.y) * scale) / current.scale };
    });
  }, [stageHeight, stageWidth]);

  useImperativeHandle(ref, () => ({ fit, zoomBy: (factor) => zoomAround(factor), scale: view.scale }), [fit, zoomAround, view.scale]);

  const visible = doc.elements.filter((element) => !element.hidden);
  const selected = useMemo(() => new Set(selection), [selection]);

  // The handles go on whatever is selected and not locked.
  useEffect(() => {
    const handles = transformer.current;
    const root = stage.current;
    if (!handles || !root) return;
    const nodes = selection
      .filter((id) => !doc.elements.find((element) => element.id === id)?.locked)
      .map((id) => root.findOne(`#${id}`))
      .filter((node): node is Konva.Node => Boolean(node));
    handles.nodes(nodes);
    handles.getLayer()?.batchDraw();
  }, [doc.elements, selection]);

  useEffect(() => {
    stage.current?.batchDraw();
  }, [redrawKey, env]);

  const toPage = (point: { x: number; y: number }) => ({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale });

  const chosen = doc.elements.filter((element) => selected.has(element.id));
  const onlyText = chosen.length === 1 && chosen[0].type === "text";
  const onlyLine = chosen.length === 1 && chosen[0].type === "line";
  const squareOnly = chosen.some((element) => element.type === "qr" || element.type === "icon");

  function pointerDown(event: KonvaEventObject<MouseEvent | TouchEvent>, element: PrintElement) {
    if (panning) return;
    event.cancelBubble = true;
    const additive = "shiftKey" in event.evt && (event.evt.shiftKey || event.evt.metaKey);
    if (additive) {
      onSelect(selected.has(element.id) ? selection.filter((id) => id !== element.id) : [...selection, element.id]);
    } else if (!selected.has(element.id)) {
      onSelect([element.id]);
    }
  }

  function dragStart(event: KonvaEventObject<DragEvent>, element: PrintElement) {
    const ids = (selected.has(element.id) ? selection : [element.id]).filter(
      (id) => !doc.elements.find((other) => other.id === id)?.locked,
    );
    if (!selected.has(element.id)) onSelect([element.id]);
    const moving = doc.elements.filter((other) => ids.includes(other.id));
    drag.current = {
      ids,
      lead: element.id,
      origins: new Map(moving.map((other) => [other.id, { x: other.x, y: other.y }])),
      box: unionBox(moving)!,
      targets: snapTargets(doc, new Set(ids), size, SAFE_MARGIN_MM),
    };
  }

  function dragMove(event: KonvaEventObject<DragEvent>) {
    const state = drag.current;
    const root = stage.current;
    if (!state || !root) return;
    const node = event.target;
    const origin = state.origins.get(state.lead)!;
    let dx = node.x() - origin.x;
    let dy = node.y() - origin.y;
    if (!event.evt.altKey) {
      const snap = snapBox(
        { left: state.box.left + dx, right: state.box.right + dx, top: state.box.top + dy, bottom: state.box.bottom + dy },
        state.targets,
        SNAP_PX / view.scale,
      );
      dx += snap.dx;
      dy += snap.dy;
      setSnapLines({ x: snap.x, y: snap.y });
    } else {
      setSnapLines({ x: null, y: null });
    }
    for (const id of state.ids) {
      const start = state.origins.get(id)!;
      const target = id === state.lead ? node : root.findOne(`#${id}`);
      target?.position({ x: start.x + dx, y: start.y + dy });
    }
  }

  function dragEnd() {
    const state = drag.current;
    const root = stage.current;
    drag.current = null;
    setSnapLines({ x: null, y: null });
    if (!state || !root) return;
    const lead = root.findOne(`#${state.lead}`);
    const origin = state.origins.get(state.lead)!;
    if (!lead) return;
    const dx = lead.x() - origin.x;
    const dy = lead.y() - origin.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    onChange({
      ...doc,
      elements: doc.elements.map((element) =>
        state.origins.has(element.id)
          ? ({ ...element, x: round(state.origins.get(element.id)!.x + dx), y: round(state.origins.get(element.id)!.y + dy) } as PrintElement)
          : element,
      ),
    });
  }

  function transformEnd() {
    const handles = transformer.current;
    if (!handles) return;
    const changes = new Map<string, Partial<PrintElement>>();
    const corner = anchor.current ? /^(top|bottom)-(left|right)$/.test(anchor.current) : true;
    for (const node of handles.nodes()) {
      const element = doc.elements.find((candidate) => candidate.id === node.id());
      if (!element) continue;
      const sx = node.scaleX();
      const sy = node.scaleY();
      node.scale({ x: 1, y: 1 });
      const base = { x: round(node.x()), y: round(node.y()), rotation: round(node.rotation()) };
      if (element.type === "text") {
        changes.set(element.id, {
          ...base,
          width: round(Math.max(2, element.width * sx)),
          ...(corner ? { size: Math.max(2, Math.round(element.size * sy * 10) / 10) } : {}),
        } as Partial<PrintElement>);
      } else if (element.type === "qr") {
        const side = round(Math.max(5, element.width * sx));
        changes.set(element.id, { ...base, width: side, height: side });
      } else if (element.type === "line") {
        changes.set(element.id, { ...base, width: round(Math.max(1, element.width * sx)) });
      } else {
        changes.set(element.id, { ...base, width: round(Math.max(1, element.width * sx)), height: round(Math.max(1, element.height * sy)) });
      }
    }
    anchor.current = null;
    onChange({
      ...doc,
      elements: doc.elements.map((element) => (changes.has(element.id) ? ({ ...element, ...changes.get(element.id) } as PrintElement) : element)),
    });
  }

  function stagePointerDown(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    const root = stage.current;
    if (!root) return;
    const pointer = root.getPointerPosition();
    if (!pointer) return;
    const middle = "button" in event.evt && event.evt.button === 1;
    if (panning || middle) {
      pan.current = { x: pointer.x, y: pointer.y, view };
      return;
    }
    if (event.target !== root) return;
    const start = toPage(pointer);
    marqueeStart.current = { ...start, additive: "shiftKey" in event.evt && event.evt.shiftKey };
    setMarquee({ left: start.x, right: start.x, top: start.y, bottom: start.y });
  }

  function stagePointerMove() {
    const root = stage.current;
    const pointer = root?.getPointerPosition();
    if (!pointer) return;
    if (pan.current) {
      const start = pan.current;
      setView({ ...start.view, x: start.view.x + pointer.x - start.x, y: start.view.y + pointer.y - start.y });
      return;
    }
    if (marqueeStart.current) {
      const at = toPage(pointer);
      const start = marqueeStart.current;
      setMarquee({ left: Math.min(start.x, at.x), right: Math.max(start.x, at.x), top: Math.min(start.y, at.y), bottom: Math.max(start.y, at.y) });
    }
  }

  function stagePointerUp() {
    pan.current = null;
    const start = marqueeStart.current;
    marqueeStart.current = null;
    if (!start || !marquee) {
      setMarquee(null);
      return;
    }
    const tiny = marquee.right - marquee.left < 2 / view.scale && marquee.bottom - marquee.top < 2 / view.scale;
    const hit = tiny ? [] : visible.filter((element) => boxesOverlap(elementBox(element), marquee)).map((element) => element.id);
    onSelect(start.additive ? [...new Set([...selection, ...hit])] : hit);
    setMarquee(null);
  }

  function wheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const pointer = stage.current?.getPointerPosition() ?? undefined;
    if (event.evt.ctrlKey || event.evt.metaKey) {
      zoomAround(Math.exp(-event.evt.deltaY * 0.0025), pointer);
    } else {
      const dx = event.evt.shiftKey && event.evt.deltaX === 0 ? event.evt.deltaY : event.evt.deltaX;
      const dy = event.evt.shiftKey && event.evt.deltaX === 0 ? 0 : event.evt.deltaY;
      setView((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
    }
  }

  // A guide is dragged out of a ruler and dropped on the page.
  function startGuide(axis: "x" | "y", event: React.PointerEvent) {
    event.preventDefault();
    const rect = container.current!.getBoundingClientRect();
    const valueAt = (clientX: number, clientY: number) =>
      axis === "x" ? (clientX - rect.left - RULER - view.x) / view.scale : (clientY - rect.top - RULER - view.y) / view.scale;
    setNewGuide({ axis, value: valueAt(event.clientX, event.clientY) });
    const move = (moveEvent: PointerEvent) => setNewGuide({ axis, value: valueAt(moveEvent.clientX, moveEvent.clientY) });
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setNewGuide(null);
      const value = round(valueAt(upEvent.clientX, upEvent.clientY));
      const extent = axis === "x" ? size.widthMm : size.heightMm;
      if (value < -size.bleedMm || value > extent + size.bleedMm) return;
      onChange({ ...doc, guides: { ...doc.guides, [axis]: [...doc.guides[axis], value] } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function moveGuide(axis: "x" | "y", index: number, value: number | null) {
    const list = [...doc.guides[axis]];
    if (value === null) list.splice(index, 1);
    else list[index] = round(value);
    onChange({ ...doc, guides: { ...doc.guides, [axis]: list } });
  }

  const hairline = 1 / view.scale;
  const far = 100_000;
  const bleed = size.bleedMm;

  return (
    // The desk around the page is a shade lighter than the darkest page a
    // design can have, so a black poster still reads as a sheet of paper.
    <div ref={container} className={`relative min-h-0 flex-1 overflow-hidden bg-canvas-line ${panning ? "cursor-grab" : ""}`}>
      <div className="absolute left-0 top-0 h-5 w-5 bg-canvas-raised" aria-hidden="true" />
      <Ruler axis="x" view={view} length={stageWidth} onStartGuide={startGuide} />
      <Ruler axis="y" view={view} length={stageHeight} onStartGuide={startGuide} />
      {stageWidth > 0 && (
        <div className="absolute" style={{ left: RULER, top: RULER }}>
          <Stage
            ref={stage}
            width={stageWidth}
            height={stageHeight}
            onMouseDown={stagePointerDown}
            onTouchStart={stagePointerDown}
            onMouseMove={stagePointerMove}
            onTouchMove={stagePointerMove}
            onMouseUp={stagePointerUp}
            onTouchEnd={stagePointerUp}
            onMouseLeave={stagePointerUp}
            onWheel={wheel}
          >
            <Layer>
              <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
                <Shape listening={false} perfectDrawEnabled={false} sceneFunc={(context) => drawBackground(nativeContext(context), doc, size, env)} />
                <Group clipX={-bleed} clipY={-bleed} clipWidth={size.widthMm + bleed * 2} clipHeight={size.heightMm + bleed * 2}>
                  {visible.map((element) => (
                    <ElementShape
                      key={element.id}
                      element={element}
                      env={env}
                      draggable={!element.locked && !panning}
                      onPointerDown={pointerDown}
                      onDragStart={dragStart}
                      onDragMove={dragMove}
                      onDragEnd={dragEnd}
                      onOpen={(target) => onOpenElement(target.id)}
                    />
                  ))}
                </Group>
              </Group>
            </Layer>
            <Layer>
              <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
                {bleed > 0 && (
                  // The strip the printer cuts away, dimmed so it reads as off the page.
                  <Shape
                    listening={false}
                    sceneFunc={(context) => {
                      const native = nativeContext(context);
                      // The desk's colour, so it reads as off the page on a dark design and a light one alike.
                      native.fillStyle = colors.desk;
                      native.globalAlpha = 0.7;
                      native.beginPath();
                      native.rect(-bleed, -bleed, size.widthMm + bleed * 2, size.heightMm + bleed * 2);
                      native.rect(size.widthMm, 0, -size.widthMm, size.heightMm);
                      native.fill("evenodd");
                    }}
                  />
                )}
                <Rect listening={false} width={size.widthMm} height={size.heightMm} stroke={colors.muted} strokeWidth={hairline} />
                {size.bleedMm >= 0 && (
                  <Rect
                    listening={false}
                    x={SAFE_MARGIN_MM}
                    y={SAFE_MARGIN_MM}
                    width={size.widthMm - SAFE_MARGIN_MM * 2}
                    height={size.heightMm - SAFE_MARGIN_MM * 2}
                    stroke={colors.volt}
                    opacity={0.55}
                    strokeWidth={hairline}
                    dash={[4 / view.scale, 4 / view.scale]}
                  />
                )}
                {doc.guides.x.map((value, index) => (
                  <Line
                    key={`gx-${index}`}
                    x={value}
                    points={[0, -far, 0, far]}
                    stroke={colors.volt}
                    strokeWidth={hairline}
                    hitStrokeWidth={8 / view.scale}
                    draggable={!panning}
                    onDragMove={(event) => event.target.y(0)}
                    onDragEnd={(event) => {
                      const x = event.target.x();
                      moveGuide("x", index, x < -bleed - 1 || x > size.widthMm + bleed + 1 ? null : x);
                    }}
                    onDblClick={() => moveGuide("x", index, null)}
                  />
                ))}
                {doc.guides.y.map((value, index) => (
                  <Line
                    key={`gy-${index}`}
                    y={value}
                    points={[-far, 0, far, 0]}
                    stroke={colors.volt}
                    strokeWidth={hairline}
                    hitStrokeWidth={8 / view.scale}
                    draggable={!panning}
                    onDragMove={(event) => event.target.x(0)}
                    onDragEnd={(event) => {
                      const y = event.target.y();
                      moveGuide("y", index, y < -bleed - 1 || y > size.heightMm + bleed + 1 ? null : y);
                    }}
                    onDblClick={() => moveGuide("y", index, null)}
                  />
                ))}
                {newGuide && (
                  <Line
                    listening={false}
                    points={newGuide.axis === "x" ? [newGuide.value, -far, newGuide.value, far] : [-far, newGuide.value, far, newGuide.value]}
                    stroke={colors.volt}
                    strokeWidth={hairline}
                    dash={[3 / view.scale, 3 / view.scale]}
                  />
                )}
                {snapLines.x !== null && (
                  <Line listening={false} points={[snapLines.x, -far, snapLines.x, far]} stroke={colors.volt} strokeWidth={hairline} />
                )}
                {snapLines.y !== null && (
                  <Line listening={false} points={[-far, snapLines.y, far, snapLines.y]} stroke={colors.volt} strokeWidth={hairline} />
                )}
                {marquee && (
                  <Rect
                    listening={false}
                    x={marquee.left}
                    y={marquee.top}
                    width={marquee.right - marquee.left}
                    height={marquee.bottom - marquee.top}
                    fill={colors.volt}
                    opacity={0.12}
                    stroke={colors.volt}
                    strokeWidth={hairline}
                  />
                )}
              </Group>
              <Transformer
                ref={transformer}
                rotateEnabled
                flipEnabled={false}
                keepRatio={squareOnly || onlyText}
                enabledAnchors={
                  onlyLine
                    ? ["middle-left", "middle-right"]
                    : squareOnly
                      ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                      : onlyText
                        ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
                        : undefined
                }
                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                rotationSnapTolerance={4}
                borderStroke={colors.volt}
                anchorStroke={colors.volt}
                anchorFill={colors.paper}
                anchorSize={9}
                anchorCornerRadius={2}
                ignoreStroke
                boundBoxFunc={(previous, next) => (Math.abs(next.width) < 4 || Math.abs(next.height) < 4 ? previous : next)}
                onTransformStart={() => {
                  anchor.current = transformer.current?.getActiveAnchor() ?? null;
                }}
                onTransformEnd={transformEnd}
              />
            </Layer>
          </Stage>
        </div>
      )}
    </div>
  );
}
