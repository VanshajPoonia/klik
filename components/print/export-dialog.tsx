"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/print/fields";
import { docAssetIds, type PrintDoc } from "@/lib/print/doc";
import type { DrawEnv } from "@/lib/print/draw";
import { downloadBlob, exportFilename, exportPdf, exportPng, feasibleDpi, unreadableCodes } from "@/lib/print/export";
import { checkDesign, type Finding } from "@/lib/print/guardrails";
import { findPreset, isDigital, type DesignSize } from "@/lib/print/presets";

/**
 * QR-4e and QR-4f: exporting, behind the checks. Every finding is listed in
 * plain words before the file is made, and a click on one goes to the thing
 * it is about. Warnings do not block: the host may know better (a code meant
 * to be small, a photo meant to be soft), so the button says "anyway".
 */
export function ExportDialog({
  doc,
  size,
  env,
  slug,
  designName,
  qrModules,
  assetSizes,
  onClose,
  onShowElement,
}: {
  doc: PrintDoc;
  size: DesignSize;
  env: DrawEnv;
  slug: string;
  designName: string;
  qrModules: number;
  assetSizes: ReadonlyMap<string, { width: number; height: number }>;
  onClose: () => void;
  onShowElement: (id: string) => void;
}) {
  const digital = isDigital(size);
  const preset = findPreset(size.preset);
  const [format, setFormat] = useState<"pdf" | "png">(digital ? "png" : "pdf");
  const [marks, setMarks] = useState(size.bleedMm > 0);
  const [dpi, setDpi] = useState<"300" | "150">("300");
  const [unreadable, setUnreadable] = useState<string[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const missingImages = docAssetIds(doc).filter((id) => !env.images.has(id));
  const findings = useMemo(
    () => checkDesign({ doc, size: { ...size, digital }, qrModules, assets: assetSizes }),
    [assetSizes, digital, doc, qrModules, size],
  );

  // The read-back: draw the page and decode every code, as a phone would.
  useEffect(() => {
    if (missingImages.length > 0) return;
    let cancelled = false;
    void unreadableCodes(doc, size, env)
      .then((ids) => !cancelled && setUnreadable(ids))
      .catch(() => !cancelled && setUnreadable([]));
    return () => {
      cancelled = true;
    };
  }, [doc, size, env, missingImages.length]);

  // TRS-3: focus in, kept in, and returned, separately from Escape, which
  // changes with `working` and would otherwise pull focus back each time.
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, { initial: closeRef });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const readBack: Finding[] = (unreadable ?? []).map((id) => ({
    key: `decode-${id}`,
    level: "warning",
    elementId: id,
    title: "A QR code did not scan in our check",
    detail: "We drew the page and read the code back, and it did not open the gallery. Move anything covering it, give it more contrast, or make it larger.",
  }));
  const all = [...readBack, ...findings];
  const warnings = all.filter((finding) => finding.level === "warning");
  const notices = all.filter((finding) => finding.level === "notice");

  const wanted = Number(dpi);
  const actualDpi = format === "pdf" ? feasibleDpi(size, wanted, marks) : feasibleDpi(size, wanted, false);

  async function run() {
    setError(null);
    setWorking(digital ? "Drawing the image…" : `Drawing at ${actualDpi} pixels per inch…`);
    try {
      // Let the message paint before the long draw holds the page.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (format === "pdf") {
        const blob = await exportPdf(doc, size, env, { dpi: actualDpi, marks }, designName);
        downloadBlob(blob, exportFilename(slug, size.preset, "pdf"));
      } else {
        const blob = await exportPng(doc, size, env, actualDpi);
        downloadBlob(blob, exportFilename(slug, size.preset, "png"));
      }
      setWorking(null);
      onClose();
    } catch (failure) {
      setWorking(null);
      setError(failure instanceof Error ? failure.message : "The file could not be made. Try a lower resolution.");
    }
  }

  const row = (finding: Finding) => (
    <li key={finding.key}>
      <button
        type="button"
        disabled={!finding.elementId}
        onClick={() => {
          if (finding.elementId) {
            onShowElement(finding.elementId);
            onClose();
          }
        }}
        className="flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition-colors enabled:hover:bg-canvas-line/50"
      >
        {finding.level === "warning" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        <span>
          <span className="block text-sm text-paper">{finding.title}</span>
          <span className="block text-xs text-muted">{finding.detail}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-canvas-line bg-canvas-raised p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-paper">Export</h2>
            <p className="mt-1 text-xs text-muted">
              {preset?.pixels
                ? `${preset.pixels.width} × ${preset.pixels.height} pixel PNG, ready to post.`
                : "A print-ready file at the page's real size. Printers usually ask for a PDF."}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={Boolean(working)}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {!digital && (
          <div className="space-y-3">
            <Segmented
              label="File"
              value={format}
              options={[
                { value: "pdf", label: "PDF for printing" },
                { value: "png", label: "PNG image" },
              ]}
              onChange={setFormat}
            />
            <Segmented
              label="Resolution"
              value={dpi}
              options={[
                { value: "300", label: "300 ppi, best" },
                { value: "150", label: "150 ppi, smaller file" },
              ]}
              onChange={setDpi}
            />
            {actualDpi < wanted && (
              <p className="text-[11px] text-muted">
                This page is too large for this device to draw at {wanted} ppi, so it will be {actualDpi}. A computer can draw it larger.
              </p>
            )}
            {format === "pdf" && size.bleedMm > 0 && (
              <Checkbox
                checked={marks}
                onChange={(event) => setMarks(event.target.checked)}
                hint={`Adds the ${size.bleedMm} mm bleed and the marks a printer cuts to. Leave it on unless your printer says otherwise.`}
              >
                Include bleed and crop marks
              </Checkbox>
            )}
          </div>
        )}

        <section className="mt-5" aria-live="polite">
          <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Checks</h3>
          {missingImages.length > 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading the photos on this page…
            </p>
          ) : (
            <>
              {unreadable === null && (
                <p className="flex items-center gap-2 py-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Scanning the QR code the way a phone would…
                </p>
              )}
              {warnings.length === 0 && unreadable !== null && (
                <p className="flex items-center gap-2 py-2 text-sm text-paper">
                  <CheckCircle2 className="h-4 w-4 text-volt" aria-hidden="true" />
                  Ready to print: the code scans, and nothing is near the cut.
                </p>
              )}
              <ul className="-mx-2">
                {warnings.map(row)}
                {notices.map(row)}
              </ul>
            </>
          )}
        </section>

        {error && (
          <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {working && (
            <span className="mr-auto flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {working}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={Boolean(working)}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={Boolean(working) || missingImages.length > 0}>
            {warnings.length > 0 ? `Export ${format.toUpperCase()} anyway` : `Export ${format.toUpperCase()}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
