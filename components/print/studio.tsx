"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Download, History, Maximize, Minus, Plus, Redo2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { AddPanel, type AddKind } from "@/components/print/add-panel";
import { ExportDialog } from "@/components/print/export-dialog";
import { LayersPanel } from "@/components/print/layers-panel";
import { MobileStudio } from "@/components/print/mobile-studio";
import { PropertiesPanel } from "@/components/print/properties-panel";
import { StudioCanvas, type CanvasHandle } from "@/components/print/studio-canvas";
import { useDesignSave } from "@/components/print/use-design-save";
import { useDocHistory } from "@/components/print/use-doc-history";
import { VersionsDialog } from "@/components/print/versions-dialog";
import { contrastRatio } from "@/lib/color";
import { docAssetIds, elementId, type PrintDoc, type PrintElement } from "@/lib/print/doc";
import { layoutText, type DrawEnv } from "@/lib/print/draw";
import { addElements, align, distribute, duplicateElements, removeElements, reorder, round, updateElement, updateElements } from "@/lib/print/edit";
import { thumbnailBlob } from "@/lib/print/export";
import { MM_PER_POINT } from "@/lib/print/fonts";
import { type DesignSize } from "@/lib/print/presets";
import { CREAM, INK, VOLT, WHITE } from "@/lib/print/templates";
import { loadDocFonts, loadImage, prepareUpload, resolveFamily, type DecodedImage } from "@/lib/print/studio-env";
import { qrModuleCount } from "@/lib/qr-shapes";

export interface StudioAssetInfo {
  id: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
}

const NARROW = "(max-width: 899px)";
const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const STATUS_LABEL = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved, retrying",
  conflict: "Changed elsewhere",
} as const;

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

/**
 * QR-4: the print studio's editor. The design is a history of whole states
 * (undo is stepping back through it), saved a moment after each change, and
 * drawn by the same code that exports it. Everything the page shows comes
 * from `doc`; the canvas, panels and dialogs only ever propose a next one.
 */
export default function Studio({
  eventId,
  slug,
  eventName,
  galleryUrl,
  accent,
  design,
  initialDoc,
  initialAssets,
  libraryHref,
}: {
  eventId: string;
  slug: string;
  eventName: string;
  galleryUrl: string;
  accent: string;
  design: { id: string; name: string; preset: string; widthMm: number; heightMm: number; bleedMm: number; revision: number };
  initialDoc: PrintDoc;
  initialAssets: StudioAssetInfo[];
  libraryHref: string;
}) {
  const history = useDocHistory(initialDoc);
  const { doc } = history;
  const [name, setName] = useState(design.name);
  const [chosen, setSelection] = useState<string[]>([]);
  const [images, setImages] = useState<Map<string, DecodedImage>>(() => new Map());
  const [redrawKey, setRedrawKey] = useState(0);
  const [assets, setAssets] = useState(initialAssets);
  // Read by work that finishes after an await (an upload), which must use the
  // list as it is then, not as it was when the work began.
  const assetsRef = useRef(initialAssets);
  const [tab, setTab] = useState<"add" | "layers">("add");
  const [panning, setPanning] = useState(false);
  const [scale, setScale] = useState(1);
  const [focusText, setFocusText] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"export" | "versions" | "background" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const loading = useRef(new Set<string>());
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);

  const size: DesignSize = useMemo(
    () => ({ preset: design.preset, widthMm: design.widthMm, heightMm: design.heightMm, bleedMm: design.bleedMm }),
    [design],
  );
  const env: DrawEnv = useMemo(
    () => ({ family: resolveFamily, images, eventName, url: galleryUrl, placeholders: true }),
    [eventName, galleryUrl, images],
  );
  const exportEnv = useMemo(() => ({ ...env, placeholders: false }), [env]);
  const qrModules = useMemo(() => qrModuleCount(galleryUrl), [galleryUrl]);
  const assetSizes = useMemo(() => new Map(assets.map((asset) => [asset.id, { width: asset.width, height: asset.height }])), [assets]);
  const swatches = useMemo(() => [...new Set([INK, CREAM, WHITE, VOLT, accent.toLowerCase(), "#5a5850", "#bdbab0"])], [accent]);

  /** Text boxes are as tall as their words, measured in their own type. */
  const measured = useCallback(
    (next: PrintDoc): PrintDoc => {
      let changed = false;
      const elements = next.elements.map((element) => {
        if (element.type !== "text") return element;
        const height = round(layoutText(element, env).heightMm);
        if (Math.abs(height - element.height) < 0.05) return element;
        changed = true;
        return { ...element, height };
      });
      return changed ? { ...next, elements } : next;
    },
    [env],
  );

  const commit = useCallback((next: PrintDoc, key?: string) => history.change(measured(next), key), [history, measured]);

  // Type first: draw nothing for export until it has loaded, then measure.
  const fontKey = doc.elements.map((element) => (element.type === "text" ? `${element.font}${element.weight}${element.italic}` : "")).join();
  useEffect(() => {
    let cancelled = false;
    void loadDocFonts(doc).then(() => {
      if (cancelled) return;
      setRedrawKey((value) => value + 1);
      const settled = measured(doc);
      if (settled !== doc) history.silent(settled);
    });
    return () => {
      cancelled = true;
    };
    // Only when the faces in use change, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  // Images the design draws, fetched once each.
  const wantedImages = docAssetIds(doc).join();
  useEffect(() => {
    for (const id of docAssetIds(doc)) {
      if (images.has(id) || loading.current.has(id)) continue;
      const asset = assets.find((candidate) => candidate.id === id);
      if (!asset) continue;
      loading.current.add(id);
      void loadImage(asset.url)
        .then((image) => setImages((current) => new Map(current).set(id, image)))
        .catch(() => {})
        .finally(() => loading.current.delete(id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedImages, assets]);

  // The list's thumbnail, drawn a little after a save once everything has loaded.
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDoc = useRef(doc);
  useEffect(() => {
    latestDoc.current = doc;
    assetsRef.current = assets;
  });
  const onSaved = useCallback(() => {
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(() => {
      const current = latestDoc.current;
      if (docAssetIds(current).some((id) => !images.has(id))) return;
      void thumbnailBlob(current, size, exportEnv)
        .then((blob) =>
          fetch(`/api/events/${eventId}/designs/${design.id}/thumbnail`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob }),
        )
        .catch(() => {});
    }, 4000);
  }, [design.id, eventId, exportEnv, images, size]);

  const save = useDesignSave({ eventId, designId: design.id, initialRevision: design.revision, doc, version: history.version, name, onSaved });

  // Nothing counts as selected that is no longer there (an undo can remove it).
  const selection = useMemo(() => {
    const present = new Set(doc.elements.map((element) => element.id));
    return chosen.filter((id) => present.has(id));
  }, [chosen, doc.elements]);
  const selected = useMemo(() => doc.elements.filter((element) => selection.includes(element.id)), [doc.elements, selection]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const ink = contrastRatio(INK, doc.background.color) >= contrastRatio(CREAM, doc.background.color) ? INK : CREAM;

  function add(item: AddKind) {
    const current = latestDoc.current;
    const W = size.widthMm;
    const H = size.heightMm;
    const short = Math.min(W, H);
    const headingPt = Math.max(12, Math.round((short * 0.1) / MM_PER_POINT));
    const center = (width: number, height: number) => ({ x: round((W - width) / 2), y: round((H - height) / 2) });
    let element: PrintElement;
    const base = { id: elementId(), rotation: 0, opacity: 1 };
    switch (item.kind) {
      case "heading":
      case "subheading":
      case "body": {
        const sizePt = item.kind === "heading" ? headingPt : item.kind === "subheading" ? Math.round(headingPt * 0.45) : Math.max(8, Math.round(headingPt * 0.28));
        const width = round(W * 0.8);
        element = {
          ...base,
          type: "text",
          text: item.kind === "heading" ? "Your heading" : item.kind === "subheading" ? "A line under it" : "Scan the code with your phone's camera to see every photo, and add yours.",
          bind: null,
          font: item.kind === "heading" ? "fraunces" : "geist",
          size: sizePt,
          weight: item.kind === "body" ? 400 : 600,
          italic: false,
          uppercase: false,
          align: "center",
          lineHeight: item.kind === "heading" ? 1.08 : 1.3,
          tracking: 0,
          color: ink,
          width,
          height: sizePt * MM_PER_POINT,
          ...center(width, sizePt * MM_PER_POINT),
        };
        break;
      }
      case "qr": {
        const side = round(Math.min(Math.max(short * 0.4, 32), 200));
        element = { ...base, type: "qr", name: "QR code", style: "classic", foreground: INK, background: WHITE, width: side, height: side, ...center(side, side) };
        break;
      }
      case "rect": {
        const width = round(W * 0.4);
        const height = round(H * 0.15);
        element = { ...base, type: "rect", fill: accent, stroke: null, strokeWidth: 0, radius: 0, width, height, ...center(width, height) };
        break;
      }
      case "ellipse": {
        const side = round(short * 0.3);
        element = { ...base, type: "ellipse", fill: accent, stroke: null, strokeWidth: 0, width: side, height: side, ...center(side, side) };
        break;
      }
      case "line": {
        const width = round(W * 0.5);
        element = { ...base, type: "line", stroke: ink, strokeWidth: 0.5, dashed: false, width, height: 3, ...center(width, 3) };
        break;
      }
      case "icon": {
        const side = round(short * 0.15);
        element = { ...base, type: "icon", icon: item.icon, color: ink, width: side, height: side, ...center(side, side) };
        break;
      }
      case "image": {
        const asset = assetsRef.current.find((candidate) => candidate.id === item.assetId);
        if (!asset) return;
        let width = W * 0.6;
        let height = (width * asset.height) / asset.width;
        if (height > H * 0.6) {
          height = H * 0.6;
          width = (height * asset.width) / asset.height;
        }
        element = { ...base, type: "image", assetId: asset.id, fit: "cover", radius: 0, width: round(width), height: round(height), ...center(width, height) };
        break;
      }
    }
    commit(addElements(current, [element]));
    setSelection([element.id]);
  }

  async function upload(file: File, asBackground = false) {
    setUploading(true);
    setUploadError(null);
    try {
      const prepared = await prepareUpload(file);
      const slotResponse = await fetch(`/api/events/${eventId}/designs/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: prepared.mimeType, sizeBytes: prepared.blob.size }),
      });
      const slot = await slotResponse.json().catch(() => ({}));
      if (!slotResponse.ok) throw new Error(slot.error ?? "The image could not be uploaded.");
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.mimeType }, body: prepared.blob });
      if (!put.ok) throw new Error("The image did not finish uploading. Try again.");
      const confirmResponse = await fetch(`/api/events/${eventId}/designs/assets/${slot.assetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: prepared.mimeType, width: prepared.width, height: prepared.height }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok) throw new Error(confirmed.error ?? "The image could not be used.");
      const asset = confirmed.asset as StudioAssetInfo;
      assetsRef.current = [asset, ...assetsRef.current];
      setAssets(assetsRef.current);
      if (asBackground) {
        const current = latestDoc.current;
        commit({ ...current, background: { ...current.background, assetId: asset.id } });
      }
      return asset;
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The image could not be uploaded.");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function deleteAsset(id: string) {
    setUploadError(null);
    const response = await fetch(`/api/events/${eventId}/designs/assets/${id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setUploadError(body.error ?? "The image could not be deleted.");
      return;
    }
    setAssets((current) => current.filter((asset) => asset.id !== id));
  }

  const removeSelected = useCallback(() => {
    if (selection.length === 0) return;
    commit(removeElements(doc, new Set(selection)));
    setSelection([]);
  }, [commit, doc, selection]);

  const duplicateSelected = useCallback(() => {
    if (selection.length === 0) return;
    const copied = duplicateElements(doc, new Set(selection));
    commit(copied.doc);
    setSelection(copied.ids);
  }, [commit, doc, selection]);

  // Keyboard: the usual shortcuts, never while typing in a field.
  useEffect(() => {
    if (narrow) return;
    const down = (event: KeyboardEvent) => {
      if (dialog) return;
      const command = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        setSelection([]);
        return;
      }
      if (typing(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPanning(true);
        return;
      }
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        history.redo();
      } else if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(doc.elements.filter((element) => !element.hidden).map((element) => element.id));
      } else if (command && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        canvas.current?.zoomBy(1.25);
      } else if (command && event.key === "-") {
        event.preventDefault();
        canvas.current?.zoomBy(0.8);
      } else if (command && event.key === "0") {
        event.preventDefault();
        canvas.current?.fit();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      } else if (event.key.startsWith("Arrow") && selection.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        commit(
          updateElements(doc, (element) =>
            selectedSet.has(element.id) && !element.locked ? ({ ...element, x: round(element.x + dx), y: round(element.y + dy) } as PrintElement) : null,
          ),
          "nudge",
        );
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [commit, dialog, doc, duplicateSelected, history, narrow, removeSelected, selectedSet, selection.length]);

  const conflictBanner = save.conflict && (
    <div className="fixed inset-x-4 top-4 z-[130] mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-canvas-raised p-4 text-sm text-paper" role="alert">
      <p className="mr-auto min-w-0">
        This design was changed in another tab or by someone else on your team. Which copy do you want to keep?
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const theirs = save.conflict!;
          history.reset(theirs.doc);
          save.takeTheirs(theirs);
          setSelection([]);
        }}
      >
        Load theirs
      </Button>
      <Button size="sm" onClick={save.keepMine}>
        Keep mine
      </Button>
    </div>
  );

  const exportDialog = dialog === "export" && (
    <ExportDialog
      doc={doc}
      size={size}
      env={exportEnv}
      slug={slug}
      designName={name}
      qrModules={qrModules}
      assetSizes={assetSizes}
      onClose={() => setDialog(null)}
      onShowElement={(id) => {
        setSelection([id]);
        setTab("layers");
      }}
    />
  );

  if (narrow) {
    return (
      <>
        {conflictBanner}
        <MobileStudio
          doc={doc}
          size={size}
          env={env}
          redrawKey={redrawKey}
          name={name}
          status={STATUS_LABEL[save.status]}
          backHref={libraryHref}
          onText={(id, text) => commit(updateElement(doc, id, { text }), `${id}:text`)}
          onExport={() => setDialog("export")}
        />
        {exportDialog}
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {conflictBanner}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-canvas-line px-2">
        <Link href={libraryHref} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-paper" aria-label="All designs">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => !name.trim() && setName(design.name)}
          aria-label="Design name"
          className="min-w-0 max-w-64 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-lg text-paper hover:border-canvas-line focus:border-volt/60 focus:outline-none"
        />
        <span className={`ml-1 text-xs ${save.status === "error" || save.status === "conflict" ? "text-amber-400" : "text-muted"}`} aria-live="polite">
          {STATUS_LABEL[save.status]}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="Undo" onClick={history.undo} disabled={!history.canUndo}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Redo" onClick={history.redo} disabled={!history.canRedo}>
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <span className="mx-1 h-6 w-px bg-canvas-line" aria-hidden="true" />
          <IconButton label="Zoom out" onClick={() => canvas.current?.zoomBy(0.8)}>
            <Minus className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <span className="w-12 text-center text-xs tabular-nums text-muted" title="Pixels per millimetre on screen, as a percentage of real size">
            {Math.round((scale / (96 / 25.4)) * 100)}%
          </span>
          <IconButton label="Zoom in" onClick={() => canvas.current?.zoomBy(1.25)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Fit the page" onClick={() => canvas.current?.fit()}>
            <Maximize className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <span className="mx-1 h-6 w-px bg-canvas-line" aria-hidden="true" />
          <Button variant="ghost" size="sm" onClick={() => setDialog("versions")}>
            <History className="h-4 w-4" aria-hidden="true" />
            Versions
          </Button>
          <Button size="sm" className="ml-1" onClick={() => setDialog("export")}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-canvas-line bg-canvas-raised">
          <div className="flex shrink-0 border-b border-canvas-line" role="tablist" aria-label="Left panel">
            {(["add", "layers"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`min-h-11 flex-1 border-b-2 text-xs font-medium ${tab === value ? "border-volt text-paper" : "border-transparent text-muted hover:text-paper"}`}
              >
                {value === "add" ? "Add" : `Layers (${doc.elements.length})`}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "add" ? (
              <AddPanel
                onAdd={add}
                assets={assets}
                uploading={uploading}
                uploadError={uploadError}
                onUpload={(file) => void upload(file).then((asset) => asset && add({ kind: "image", assetId: asset.id }))}
                onDeleteAsset={(id) => void deleteAsset(id)}
                onUseAsBackground={(id) => commit({ ...doc, background: { ...doc.background, assetId: id } })}
              />
            ) : (
              <LayersPanel
                elements={doc.elements}
                selection={selection}
                onSelect={(ids, additive) =>
                  setSelection((current) => (additive ? (current.includes(ids[0]) ? current.filter((id) => id !== ids[0]) : [...current, ...ids]) : ids))
                }
                onToggle={(id, field) => {
                  const element = doc.elements.find((candidate) => candidate.id === id);
                  if (!element) return;
                  commit(updateElement(doc, id, { [field]: !element[field] } as Partial<PrintElement>));
                  if (field === "hidden" && !element.hidden) setSelection((current) => current.filter((value) => value !== id));
                }}
              />
            )}
          </div>
        </aside>

        <StudioCanvas
          ref={canvas}
          doc={doc}
          size={size}
          env={env}
          redrawKey={redrawKey}
          selection={selection}
          onSelect={setSelection}
          onChange={commit}
          panning={panning}
          onOpenElement={(id) => {
            const element = doc.elements.find((candidate) => candidate.id === id);
            if (element?.type === "text") setFocusText(id);
          }}
          onScaleChange={setScale}
        />

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-canvas-line bg-canvas-raised">
          <PropertiesPanel
            doc={doc}
            size={size}
            selection={selected}
            swatches={swatches}
            eventName={eventName}
            url={galleryUrl}
            qrModules={qrModules}
            focusText={focusText}
            onFocusTextDone={() => setFocusText(null)}
            onPatch={(id, patch, key) => commit(updateElement(doc, id, patch), key)}
            onPage={(patch, key) => commit({ ...doc, background: { ...doc.background, ...patch } }, key)}
            onAlign={(edge) => commit(align(doc, selectedSet, edge, size))}
            onDistribute={(axis) => commit(distribute(doc, selectedSet, axis))}
            onReorder={(move) => commit(reorder(doc, selectedSet, move))}
            onDuplicate={duplicateSelected}
            onDelete={removeSelected}
            onPickBackground={() => setDialog("background")}
            assets={assets}
          />
        </aside>
      </div>

      {exportDialog}
      {dialog === "versions" && (
        <VersionsDialog
          eventId={eventId}
          designId={design.id}
          onClose={() => setDialog(null)}
          onRestored={(restored) => {
            history.reset(restored.doc);
            save.adopt(restored);
            setSelection([]);
          }}
        />
      )}
      {dialog === "background" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a background photo"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6"
          onClick={(event) => event.target === event.currentTarget && setDialog(null)}
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-canvas-line bg-canvas-raised p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl text-paper">Background photo</h2>
              <IconButton label="Close" onClick={() => setDialog(null)}>
                <X className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            </div>
            <p className="mb-3 text-xs text-muted">It fills the page out to the bleed. Words over a busy photo are hard to read; a shape behind them helps.</p>
            <div className="grid grid-cols-3 gap-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    commit({ ...doc, background: { ...doc.background, assetId: asset.id } });
                    setDialog(null);
                  }}
                  className="aspect-square overflow-hidden rounded-lg border border-canvas-line hover:border-volt/50"
                  aria-label="Use this photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-canvas-line text-center text-xs text-muted hover:text-paper">
                {uploading ? "Uploading…" : "Upload a photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file, true).then((asset) => asset && setDialog(null));
                  }}
                />
              </label>
            </div>
            {uploadError && (
              <p className="mt-3 text-xs text-red-300" role="alert">
                {uploadError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
