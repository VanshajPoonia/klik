"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PrintDoc, TextElement } from "@/lib/print/doc";
import { displayUrl, renderPage, type DrawEnv } from "@/lib/print/draw";
import type { DesignSize } from "@/lib/print/presets";

/**
 * QR-4, on a phone: the roadmap's honest version. Dragging handles under a
 * thumb on a small screen is a broken experience, so a phone gets the page,
 * its words to change, and export, and is told that moving things needs a
 * computer, rather than being handed an editor that fights it.
 */
export function MobileStudio({
  doc,
  size,
  env,
  redrawKey,
  name,
  status,
  backHref,
  onText,
  onExport,
}: {
  doc: PrintDoc;
  size: DesignSize;
  env: DrawEnv;
  redrawKey: number;
  name: string;
  status: string;
  backHref: string;
  onText: (id: string, text: string) => void;
  onExport: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = canvas.current;
    const holder = frame.current;
    if (!target || !holder) return;
    const width = holder.clientWidth * (window.devicePixelRatio || 1);
    renderPage(target, doc, size, env, { pixelsPerMm: width / size.widthMm, includeBleed: false });
  }, [doc, size, env, redrawKey]);

  const texts = doc.elements.filter((element): element is TextElement => element.type === "text" && !element.hidden);

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-paper">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All designs
        </Link>
        <span className="text-xs text-muted" aria-live="polite">
          {status}
        </span>
      </div>
      <h1 className="mt-2 truncate font-display text-xl text-paper">{name}</h1>

      <div ref={frame} className="mt-4 overflow-hidden rounded-xl border border-canvas-line">
        <canvas ref={canvas} className="block h-auto w-full" aria-label={`Preview of ${name}`} role="img" />
      </div>

      <p className="mt-4 flex gap-2 rounded-xl border border-canvas-line bg-canvas-raised p-3 text-xs text-muted">
        <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
        Here you can change the words and export. Moving and resizing things needs a bigger screen: open this design on a
        computer for the full editor.
      </p>

      <section className="mt-6 space-y-4">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">The words</h2>
        {texts.length === 0 && <p className="text-sm text-muted">This design has no text.</p>}
        {texts.map((element, index) => (
          <label key={element.id} className="block">
            <span className="mb-1.5 block text-xs text-muted">{element.name ?? `Text ${index + 1}`}</span>
            {element.bind ? (
              <span className="block rounded-xl border border-canvas-line bg-canvas px-3.5 py-2.5 text-sm text-muted">
                {element.bind === "eventName" ? env.eventName : displayUrl(env.url)}
                <span className="mt-1 block text-[11px]">
                  {element.bind === "eventName" ? "Follows the event's name." : "Follows the gallery's address."}
                </span>
              </span>
            ) : (
              <textarea
                value={element.text}
                rows={Math.min(4, element.text.split("\n").length + 1)}
                maxLength={600}
                onChange={(event) => onText(element.id, event.target.value)}
                className="w-full rounded-xl border border-canvas-line bg-canvas px-3.5 py-2.5 text-base text-paper focus:border-volt/60 focus:outline-none"
              />
            )}
          </label>
        ))}
      </section>

      <Button onClick={onExport} className="mt-8 w-full">
        <Download className="h-4 w-4" aria-hidden="true" />
        Export
      </Button>
    </main>
  );
}
