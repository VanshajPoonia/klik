"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import type { WatermarkPosition } from "@/lib/schema";
import { WATERMARK_DEFAULTS } from "@/lib/watermark-layout";
import { WATERMARK_LIMITS, type WatermarkProfile } from "@/lib/watermark-settings";
import {
  canvasToPng,
  drawStamp,
  loadImage,
  paintStamp,
  shrinkLogo,
  stampFontReady,
  type StampFont,
} from "@/lib/watermark-stamp";

const POSITIONS: Array<[WatermarkPosition, string]> = [
  ["bottom-right", "Bottom right"],
  ["bottom-left", "Bottom left"],
  ["center", "Middle"],
  ["tiled", "All over"],
];

type Logo = { image: HTMLImageElement; width: number; height: number; upload: Blob | null };

/** A stand-in photo for the preview: bright sky, dark ground, so legibility shows on both. */
function paintSample(context: CanvasRenderingContext2D, width: number, height: number) {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#f6d7a7");
  sky.addColorStop(0.55, "#e9a46a");
  sky.addColorStop(0.56, "#3f4a3c");
  sky.addColorStop(1, "#1d241c");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(255, 244, 214, 0.9)";
  context.beginPath();
  context.arc(width * 0.7, height * 0.32, height * 0.09, 0, Math.PI * 2);
  context.fill();
}

/**
 * MED-10: the photographer's watermark for proofs. Their words and logo are
 * drawn here into a transparent image, and the preview lays it over a sample
 * photo exactly as the server will lay it over theirs.
 */
export function WatermarkCard({ initial }: { initial: WatermarkProfile | null }) {
  const [saved, setSaved] = useState(initial);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [font, setFont] = useState<StampFont>(initial?.font ?? "sans");
  const [position, setPosition] = useState<WatermarkPosition>(initial?.position ?? WATERMARK_DEFAULTS.position);
  const [opacity, setOpacity] = useState(initial?.opacity ?? WATERMARK_DEFAULTS.opacity);
  const [scale, setScale] = useState(initial?.scale ?? WATERMARK_DEFAULTS.scale);
  const [buyNote, setBuyNote] = useState(initial?.buyNote ?? "");
  const [buyUrl, setBuyUrl] = useState(initial?.buyUrl?.replace(/^mailto:/, "") ?? "");
  const [logo, setLogo] = useState<Logo | null>(null);
  const [logoAction, setLogoAction] = useState<"keep" | "replace" | "remove">("keep");
  const [fontReady, setFontReady] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The saved logo, fetched from this origin so the canvas can be saved again.
  useEffect(() => {
    if (!initial?.logoUrl) return;
    let live = true;
    void loadImage(initial.logoUrl)
      .then((image) => {
        if (live) setLogo({ image, width: image.naturalWidth, height: image.naturalHeight, upload: null });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [initial?.logoUrl]);

  useEffect(() => {
    let live = true;
    void stampFontReady(font).then(() => {
      if (live) setFontReady((round) => round + 1);
    });
    return () => {
      live = false;
    };
  }, [font]);

  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    paintSample(context, canvas.width, canvas.height);
    if (!label.trim() && !logo) return;
    const stamp = drawStamp({ label, logo, font });
    paintStamp(context, canvas, stamp, { position, opacity, scale });
  }, [label, logo, font, position, opacity, scale, fontReady]);

  async function pickLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > WATERMARK_LIMITS.logoBytes * 4) {
      setMessage({ tone: "error", text: "That logo is too big. Use one under 16 MB." });
      return;
    }
    const shrunk = await shrinkLogo(file, WATERMARK_LIMITS.logoMaxSide);
    if (!shrunk) {
      setMessage({ tone: "error", text: "That logo could not be opened. Use a PNG, JPEG or WebP." });
      return;
    }
    setMessage(null);
    setLogo({ image: shrunk.image, width: shrunk.image.naturalWidth, height: shrunk.image.naturalHeight, upload: shrunk.blob });
    setLogoAction("replace");
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await stampFontReady(font);
      const stamp = await canvasToPng(drawStamp({ label, logo, font }));
      if (!stamp) throw new Error("The watermark could not be drawn.");
      const form = new FormData();
      form.set(
        "settings",
        JSON.stringify({ label, font, position, opacity, scale, buyNote: buyNote || null, buyUrl: buyUrl || null, logo: logoAction }),
      );
      form.set("stamp", stamp, "stamp.png");
      if (logoAction === "replace" && logo?.upload) form.set("logo", logo.upload, "logo.png");
      const response = await fetch("/api/me/watermark", { method: "PUT", body: form });
      const data = (await response.json().catch(() => null)) as { watermark?: WatermarkProfile; error?: string } | null;
      if (!response.ok || !data?.watermark) throw new Error(data?.error ?? "Could not save your watermark.");
      setSaved(data.watermark);
      setLogoAction("keep");
      if (logo) setLogo({ ...logo, upload: null });
      setMessage({ tone: "ok", text: "Saved. Proofs you upload from now on carry this watermark." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save your watermark." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/me/watermark", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setMessage({ tone: "error", text: "Could not remove it. Try again." });
      return;
    }
    setSaved(null);
    setLogo(null);
    setLogoAction("keep");
    setMessage({ tone: "ok", text: "Removed. Proofs already uploaded keep their watermark until you release them." });
  }

  const pill = (active: boolean) =>
    `min-h-10 rounded-full border px-3 text-sm transition-colors ${
      active ? "border-volt bg-volt text-on-volt" : "border-canvas-line text-paper hover:border-paper/40"
    }`;

  return (
    <section id="watermark" className="space-y-4" aria-labelledby="watermark-heading">
      <div>
        <h2 id="watermark-heading" className="flex items-center gap-2 text-sm font-medium text-paper">
          <Stamp className="h-4 w-4 text-volt" aria-hidden="true" />
          Watermark for proofs
        </h2>
        <p className="mt-1 max-w-lg text-xs text-muted">
          For photographers. Photos you add to an event with proofs turned on carry this mark for everyone else,
          your client included. You see them clean, and you release the clean photos when you are ready. Proofs work
          on Premium and Venue events.
        </p>
      </div>

      <canvas
        ref={preview}
        width={720}
        height={480}
        className="aspect-[3/2] w-full rounded-xl border border-canvas-line"
        role="img"
        aria-label="Preview of your watermark on a sample photo"
      />

      <Field label="Words" htmlFor="watermark-label" hint="Your name or studio, as it should appear.">
        <input
          id="watermark-label"
          className={inputClass}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={WATERMARK_LIMITS.label}
          placeholder="© Your Name Photography"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Typeface">
        <button type="button" aria-pressed={font === "sans"} className={pill(font === "sans")} onClick={() => setFont("sans")}>
          Clean
        </button>
        <button
          type="button"
          aria-pressed={font === "serif"}
          className={`${pill(font === "serif")} font-display`}
          onClick={() => setFont("serif")}
        >
          Classic
        </button>
        <span className="mx-1 h-6 w-px bg-canvas-line" aria-hidden="true" />
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void pickLogo(event)} />
        <Button type="button" size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          {logo ? "Change logo" : "Add a logo"}
        </Button>
        {logo && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setLogo(null);
              setLogoAction(saved?.logoUrl ? "remove" : "keep");
            }}
          >
            Remove logo
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Where it goes">
        {POSITIONS.map(([value, name]) => (
          <button key={value} type="button" aria-pressed={position === value} className={pill(position === value)} onClick={() => setPosition(value)}>
            {name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-paper">
          Size
          <input
            type="range"
            min={10}
            max={60}
            value={Math.round(scale * 100)}
            onChange={(event) => setScale(Number(event.target.value) / 100)}
            className="mt-2 block w-full accent-volt"
          />
        </label>
        <label className="block text-sm text-paper">
          Strength
          <input
            type="range"
            min={10}
            max={90}
            value={Math.round(opacity * 100)}
            onChange={(event) => setOpacity(Number(event.target.value) / 100)}
            className="mt-2 block w-full accent-volt"
          />
        </label>
      </div>

      <Field
        label="How to get the full photo"
        htmlFor="watermark-note"
        hint="Shown under each proof. Klik takes no part in the sale: you are paid however you usually are."
      >
        <textarea
          id="watermark-note"
          className={`${inputClass} min-h-20`}
          value={buyNote}
          onChange={(event) => setBuyNote(event.target.value)}
          maxLength={WATERMARK_LIMITS.buyNote}
          placeholder="Full-resolution photos are $15 each, or $200 for the set."
        />
      </Field>
      <Field label="Link" htmlFor="watermark-link" hint="A web page starting https://, or an email address. Optional.">
        <input
          id="watermark-link"
          className={inputClass}
          value={buyUrl}
          onChange={(event) => setBuyUrl(event.target.value)}
          maxLength={WATERMARK_LIMITS.buyUrl}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@studio.com"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || !label.trim()}>
          {busy ? "Saving…" : saved ? "Save changes" : "Save watermark"}
        </Button>
        {saved && (
          <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
            Remove watermark
          </Button>
        )}
        {message && (
          <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-red-400"}`} role={message.tone === "ok" ? "status" : "alert"}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
