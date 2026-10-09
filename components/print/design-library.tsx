"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, FileImage, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass, selectClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api-client";
import { renderPage, type DrawEnv } from "@/lib/print/draw";
import { CUSTOM_PRESET_KEY, MAX_CUSTOM_MM, MIN_CUSTOM_MM, PRINT_PRESETS, describeSize, findPreset } from "@/lib/print/presets";
import { PRINT_TEMPLATES } from "@/lib/print/templates";
import { loadDocFonts, resolveFamily } from "@/lib/print/studio-env";

export interface LibraryDesign {
  id: string;
  name: string;
  preset: string;
  widthMm: number;
  heightMm: number;
  updatedAt: string;
  thumbnailUrl: string | null;
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * QR-4: the print studio's front page. Templates first, drawn with this
 * event's own name and QR code so the host sees their sign rather than a
 * sample; then a blank page of any size; then what they have made.
 */
export function DesignLibrary({
  eventId,
  eventName,
  galleryUrl,
  dateLabel,
  accent,
  backHref,
  initialDesigns,
}: {
  eventId: string;
  eventName: string;
  galleryUrl: string;
  dateLabel: string | null;
  accent: string;
  backHref: string;
  initialDesigns: LibraryDesign[];
}) {
  const router = useRouter();
  const [designs, setDesigns] = useState(initialDesigns);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState("a4");
  const [customWidth, setCustomWidth] = useState("20");
  const [customHeight, setCustomHeight] = useState("20");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const built = useMemo(
    () => PRINT_TEMPLATES.map((template) => ({ template, doc: template.build({ eventName, dateLabel, accent }) })),
    [eventName, dateLabel, accent],
  );

  // Drawn here, once the type has loaded, exactly as the studio will draw them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all(built.map(({ doc }) => loadDocFonts(doc)));
      if (cancelled) return;
      const env: DrawEnv = { family: resolveFamily, images: new Map(), eventName, url: galleryUrl, placeholders: false };
      const next: Record<string, string> = {};
      for (const { template, doc } of built) {
        const size = findPreset(template.preset)!;
        const canvas = document.createElement("canvas");
        renderPage(canvas, doc, { ...size, preset: size.key }, env, { pixelsPerMm: 360 / Math.max(size.widthMm, size.heightMm), includeBleed: false });
        next[template.key] = canvas.toDataURL("image/jpeg", 0.85);
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [built, eventName, galleryUrl]);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const result = await apiRequest<{ design: { id: string } }>(
      `/api/events/${eventId}/designs`,
      { method: "POST", body },
      "The design could not be made.",
    );
    if (!result.ok) {
      setError(result.error);
      setBusy(null);
      return;
    }
    router.push(`/dashboard/events/${eventId}/print/${result.data.design.id}`);
  }

  async function duplicate(design: LibraryDesign) {
    setBusy(`copy-${design.id}`);
    setError(null);
    const result = await apiRequest<{ design: LibraryDesign }>(
      `/api/events/${eventId}/designs`,
      { method: "POST", body: { duplicateOf: design.id } },
      "The design could not be copied.",
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDesigns((current) => [{ ...result.data.design, thumbnailUrl: design.thumbnailUrl }, ...current]);
  }

  async function remove(design: LibraryDesign) {
    setBusy(`delete-${design.id}`);
    setError(null);
    const result = await apiRequest(`/api/events/${eventId}/designs/${design.id}`, { method: "DELETE" }, "The design could not be deleted.");
    setBusy(null);
    setConfirmingDelete(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDesigns((current) => current.filter((row) => row.id !== design.id));
  }

  const startBlank = () => {
    if (preset === CUSTOM_PRESET_KEY) {
      void create({ preset, widthMm: Number(customWidth) * 10, heightMm: Number(customHeight) * 10 }, "blank");
    } else {
      void create({ preset }, "blank");
    }
  };
  const customValid = [customWidth, customHeight].every((value) => {
    const mm = Number(value) * 10;
    return Number.isFinite(mm) && mm >= MIN_CUSTOM_MM && mm <= MAX_CUSTOM_MM;
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-16 pt-10 md:px-10">
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the event
      </Link>
      <header className="mb-8 mt-4">
        <h1 className="font-display text-3xl text-paper">Print studio</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Posters, table cards, stickers and signs with {eventName}&apos;s QR code on them. Every design follows the
          gallery&apos;s address, so a sign made today still works if you change it. Export a print-ready PDF.
        </p>
        <p className="mt-2 text-xs text-muted md:hidden">
          On a phone you can start from a template, change the words and export. Moving things around needs a computer.
        </p>
      </header>

      {error && (
        <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      {designs.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">Your designs</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {designs.map((design) => (
              <li key={design.id} className="flex flex-col">
                <Link
                  href={`/dashboard/events/${eventId}/print/${design.id}`}
                  className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised p-3 transition-colors hover:border-volt/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                >
                  {design.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={design.thumbnailUrl} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <FileImage className="h-8 w-8 text-muted" aria-hidden="true" />
                  )}
                </Link>
                <div className="mt-2 flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-paper">{design.name}</p>
                    <p className="text-xs text-muted">
                      {findPreset(design.preset)?.label ?? describeSize(design)} · {relativeTime(design.updatedAt)}
                    </p>
                  </div>
                  <div className="-mr-2 flex shrink-0">
                    <IconButton label={`Copy ${design.name}`} onClick={() => void duplicate(design)} disabled={busy !== null}>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`Delete ${design.name}`} tone="danger" onClick={() => setConfirmingDelete(design.id)} disabled={busy !== null}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
                {confirmingDelete === design.id && (
                  <div className="mt-2 rounded-xl border border-canvas-line bg-canvas-raised p-3 text-xs text-paper">
                    Delete this design? It cannot be brought back.
                    <div className="mt-2 flex gap-2">
                      <Button variant="danger" size="sm" onClick={() => void remove(design)} disabled={busy !== null}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(null)}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-12">
        <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">Start from a template</h2>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {built.map(({ template }) => {
            const size = findPreset(template.preset)!;
            return (
              <li key={template.key}>
                <button
                  type="button"
                  onClick={() => void create({ template: template.key }, template.key)}
                  disabled={busy !== null}
                  className="group flex w-full flex-col text-left focus-visible:outline-none disabled:opacity-60"
                >
                  <span className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised p-4 transition-colors group-hover:border-volt/50 group-focus-visible:ring-2 group-focus-visible:ring-volt">
                    {previews[template.key] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previews[template.key]} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="h-3/4 w-2/3 animate-pulse rounded-lg bg-canvas-line" aria-hidden="true" />
                    )}
                  </span>
                  <span className="mt-2 text-sm font-medium text-paper">
                    {busy === template.key ? "Opening…" : template.name}
                  </span>
                  <span className="text-xs text-muted">{template.blurb}</span>
                  <span className="sr-only">{size.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">Or start blank</h2>
        <div className="flex max-w-2xl flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1">
            <span className="mb-1.5 block text-xs text-muted">Size</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value)} className={selectClass}>
              {PRINT_PRESETS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
              <option value={CUSTOM_PRESET_KEY}>Custom size</option>
            </select>
          </label>
          {preset === CUSTOM_PRESET_KEY && (
            <>
              <label className="w-28">
                <span className="mb-1.5 block text-xs text-muted">Width, cm</span>
                <input inputMode="decimal" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} className={inputClass} />
              </label>
              <label className="w-28">
                <span className="mb-1.5 block text-xs text-muted">Height, cm</span>
                <input inputMode="decimal" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} className={inputClass} />
              </label>
            </>
          )}
          <Button onClick={startBlank} disabled={busy !== null || (preset === CUSTOM_PRESET_KEY && !customValid)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {busy === "blank" ? "Opening…" : "Blank design"}
          </Button>
        </div>
        {preset === CUSTOM_PRESET_KEY && !customValid && (
          <p className="mt-2 text-xs text-muted">
            Between {MIN_CUSTOM_MM / 10} and {MAX_CUSTOM_MM / 10} cm on each side.
          </p>
        )}
      </section>
    </main>
  );
}
