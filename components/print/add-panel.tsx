"use client";

import { useRef, useState } from "react";
import { Circle, Image as ImageIcon, Minus, QrCode, Square, Trash2, Type, Upload } from "lucide-react";
import { PanelSection } from "@/components/print/fields";
import { PRINT_ICONS, PRINT_ICON_KEYS, type PrintIconKey } from "@/lib/print/icons";

export type AddKind =
  | { kind: "heading" | "subheading" | "body" | "qr" | "rect" | "ellipse" | "line" }
  | { kind: "icon"; icon: PrintIconKey }
  | { kind: "image"; assetId: string };

export interface PanelAsset {
  id: string;
  url: string;
  width: number;
  height: number;
}

const tile =
  "flex min-h-11 items-center gap-2 rounded-lg border border-canvas-line px-3 text-left text-xs text-paper transition-colors hover:border-volt/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt";

/**
 * QR-4b and QR-4c: everything that can go on a page. New things land in the
 * middle of the page, sized for it, ready to be moved.
 */
export function AddPanel({
  onAdd,
  assets,
  uploading,
  uploadError,
  onUpload,
  onDeleteAsset,
  onUseAsBackground,
}: {
  onAdd: (item: AddKind) => void;
  assets: PanelAsset[];
  uploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onDeleteAsset: (id: string) => void;
  onUseAsBackground: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState(false);
  return (
    <div>
      <PanelSection title="Text">
        <button type="button" className={`${tile} w-full font-display text-base`} onClick={() => onAdd({ kind: "heading" })}>
          <Type className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          Add a heading
        </button>
        <button type="button" className={`${tile} w-full text-sm`} onClick={() => onAdd({ kind: "subheading" })}>
          <Type className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
          Add a subheading
        </button>
        <button type="button" className={`${tile} w-full`} onClick={() => onAdd({ kind: "body" })}>
          <Type className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
          Add a line of text
        </button>
      </PanelSection>
      <PanelSection title="QR code">
        <button type="button" className={`${tile} w-full`} onClick={() => onAdd({ kind: "qr" })}>
          <QrCode className="h-4 w-4 shrink-0 text-volt" aria-hidden="true" />
          Add the gallery&apos;s QR code
        </button>
      </PanelSection>
      <PanelSection title="Shapes">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={`${tile} justify-center`} onClick={() => onAdd({ kind: "rect" })} aria-label="Add a rectangle">
            <Square className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={`${tile} justify-center`} onClick={() => onAdd({ kind: "ellipse" })} aria-label="Add a circle">
            <Circle className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={`${tile} justify-center`} onClick={() => onAdd({ kind: "line" })} aria-label="Add a line">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </PanelSection>
      <PanelSection title="Icons">
        <div className="grid grid-cols-5 gap-1.5">
          {PRINT_ICON_KEYS.map((icon) => (
            <button
              key={icon}
              type="button"
              title={PRINT_ICONS[icon].label}
              aria-label={`Add ${PRINT_ICONS[icon].label.toLowerCase()}`}
              onClick={() => onAdd({ kind: "icon", icon })}
              className="flex h-10 items-center justify-center rounded-lg border border-canvas-line text-paper transition-colors hover:border-volt/50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d={PRINT_ICONS[icon].path} />
              </svg>
            </button>
          ))}
        </div>
      </PanelSection>
      <PanelSection title="Your photos and logos">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
        <button type="button" className={`${tile} w-full`} onClick={() => input.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          {uploading ? "Uploading…" : "Upload a photo or logo"}
        </button>
        <p className="text-[11px] text-muted">JPEG, PNG or WebP, up to 15 MB. A PNG keeps its transparent background.</p>
        {uploadError && (
          <p className="text-[11px] text-red-300" role="alert">
            {uploadError}
          </p>
        )}
        {assets.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {assets.map((asset) => (
                <div key={asset.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onAdd({ kind: "image", assetId: asset.id })}
                    aria-label="Add this image to the page"
                    className="block aspect-square w-full overflow-hidden rounded-lg border border-canvas-line bg-canvas transition-colors hover:border-volt/50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                  </button>
                  {managing && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-between gap-0.5 p-0.5">
                      <button
                        type="button"
                        onClick={() => onUseAsBackground(asset.id)}
                        className="rounded bg-black/70 px-1 text-[10px] text-paper"
                        aria-label="Use as the page background"
                      >
                        <ImageIcon className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAsset(asset.id)}
                        className="rounded bg-black/70 px-1 text-[10px] text-red-300"
                        aria-label="Delete this image"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setManaging((value) => !value)} className="text-[11px] text-muted hover:text-paper">
              {managing ? "Done" : "Set a background or delete images"}
            </button>
          </>
        )}
      </PanelSection>
    </div>
  );
}
