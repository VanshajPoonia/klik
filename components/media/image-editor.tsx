"use client";

import { useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import FilerobotImageEditor, { TABS, TOOLS } from "react-filerobot-image-editor";

/**
 * CAM-2: the photo editor, Filerobot (MIT), in Klik's colours.
 *
 * Loaded with `next/dynamic` and `ssr: false` by whoever opens it: it touches
 * `window` on import and is a few hundred kilobytes that nobody who does not
 * edit should download.
 *
 * It edits a copy. The caller hands it the photo's bytes as a local object
 * URL, so the canvas is never tainted by a cross-origin image, and gets a JPEG
 * back, which goes up through the ordinary upload path as a new photo that
 * points at the original (`media.derived_from_id`). The original is never
 * touched.
 */

const SAVE_QUALITY = 0.92;

/** A colour token as the page has it now, so a Premium gallery's own accent carries in. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bytes = atob(body);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mime });
}

export default function ImageEditor({
  source,
  accent,
  onSave,
  onClose,
}: {
  /** An object URL of the photo's bytes. */
  source: string;
  /** The event's accent, which a Premium gallery may have changed. */
  accent?: string;
  /** Resolves when the edited copy is safely uploaded; throws to say why not. */
  onSave: (edited: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const theme = useMemo(() => {
    const canvas = token("--color-canvas", "#050505");
    const raised = token("--color-canvas-raised", "#121210");
    const line = token("--color-canvas-line", "#232320");
    const paper = token("--color-paper", "#f3f1e9");
    const muted = token("--color-muted", "#8c8a80");
    const volt = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : token("--color-volt", "#edee00");
    const onVolt = token("--color-on-volt", "#050505");
    const font = getComputedStyle(document.body).getPropertyValue("--font-geist-sans").trim() || "system-ui, sans-serif";
    return {
      palette: {
        "bg-primary": raised,
        "bg-secondary": canvas,
        "bg-stateless": raised,
        "bg-primary-stateless": raised,
        "bg-primary-light": raised,
        "bg-primary-hover": line,
        "bg-primary-active": line,
        "bg-hover": line,
        "bg-active": line,
        "bg-grey": line,
        "bg-base-light": raised,
        "bg-base-medium": line,
        "bg-tooltip": line,
        "txt-primary": paper,
        "txt-secondary": muted,
        "txt-secondary-invert": canvas,
        "txt-placeholder": muted,
        "accent-primary": volt,
        "accent-primary-hover": volt,
        "accent-primary-active": volt,
        "accent-stateless": volt,
        "accent-primary-disabled": line,
        "accent-secondary-disabled": line,
        "btn-disabled-text": muted,
        "borders-disabled": line,
        "btn-primary-text": onVolt,
        "btn-secondary-text": paper,
        "icon-primary": paper,
        "icons-secondary": muted,
        "icons-placeholder": muted,
        "icons-muted": muted,
        "icons-primary-hover": paper,
        "icons-secondary-hover": paper,
        "link-primary": paper,
        "link-hover": paper,
        "link-active": volt,
        "borders-primary": line,
        "borders-primary-hover": muted,
        "borders-secondary": line,
        "borders-strong": muted,
        "borders-button": line,
        "borders-item": line,
        "borders-base-light": line,
        "borders-base-medium": line,
        "active-secondary": line,
        "active-secondary-hover": line,
      },
      typography: { fontFamily: font },
    };
  }, [accent]);

  // TRS-3: focus in on open and back to Edit on close. Not trapped: the
  // editor's own popovers render outside this box.
  const editorRef = useRef<HTMLDivElement>(null);
  useDialogFocus(editorRef, { trap: false });

  return (
    <div ref={editorRef} className="fixed inset-0 z-[130] flex flex-col bg-canvas" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div className="relative min-h-0 flex-1 [&_.FIE_root]:!h-full">
        <FilerobotImageEditor
          source={source}
          theme={theme}
          tabsIds={[TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE]}
          defaultTabId={TABS.ADJUST}
          defaultToolId={TOOLS.CROP}
          Crop={{
            presetsItems: [
              { titleKey: "Square", ratio: 1 },
              { titleKey: "Portrait 4:5", ratio: 4 / 5 },
              { titleKey: "Story 9:16", ratio: 9 / 16 },
              { titleKey: "Landscape 3:2", ratio: 3 / 2 },
              { titleKey: "Wide 16:9", ratio: 16 / 9 },
            ],
          }}
          Text={{ text: "Add text", fontFamily: "Arial" }}
          annotationsCommon={{ fill: token("--color-paper", "#f3f1e9") }}
          Rotate={{ componentType: "slider", angle: 90 }}
          defaultSavedImageType="jpeg"
          defaultSavedImageQuality={SAVE_QUALITY}
          savingPixelRatio={1}
          previewPixelRatio={typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1)}
          observePluginContainerSize
          avoidChangesNotSavedAlertOnLeave
          disableSaveIfNoChanges
          // Straight to saving: no file-name dialog for a photo that is going
          // back into the gallery, not to a disk.
          onBeforeSave={() => false}
          onSave={async (saved) => {
            if (savingRef.current || !saved.imageBase64) return;
            savingRef.current = true;
            setSaving(true);
            setError(null);
            try {
              await onSave(dataUrlToBlob(saved.imageBase64));
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "The edit did not save. Try again.");
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
          onClose={() => {
            if (!savingRef.current) onClose();
          }}
        />
      </div>
      {(saving || error) && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-6 z-[140] flex justify-center px-4"
          role={error ? "alert" : "status"}
        >
          <p className="pointer-events-auto max-w-md rounded-full border border-canvas-line bg-canvas-raised px-5 py-2.5 text-sm text-paper">
            {saving ? "Saving a copy to the gallery…" : error}
          </p>
        </div>
      )}
    </div>
  );
}
