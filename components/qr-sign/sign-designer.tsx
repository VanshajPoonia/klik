"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Check, Lock, Printer, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/field";
import { formatLookDate } from "@/components/guest/look-hero";
import { GALLERY_TEMPLATES, templateByKey, type TemplateFields, type TemplateKey } from "@/lib/gallery-templates";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/locale";
import { QR_STYLES, type QrStyle } from "@/lib/qr-shapes";
import { styledQrSvg } from "@/lib/qr-svg";
import {
  GALLERY_COLORWAY,
  SIGN_COPY,
  SIGN_HEADLINE_MAX,
  SIGN_PAPERS,
  SIGN_TITLE_MAX,
  cleanSignOptions,
  paperByKey,
  signBaseColors,
  signContent,
  signDefaults,
  signHasMessage,
  signPalette,
  type SignCaps,
  type SignOptions,
  type SignPalette,
} from "@/lib/qr-sign";
import { QrSign } from "./qr-sign";

/**
 * QR-5: the sign page. Options on one side, the sheet on the other, and the
 * sheet is the one that prints: the same component, rendered again at its real
 * size for the printer (`.qs-print-root`), so there is no second layout to
 * drift from the first.
 *
 * The code is drawn here, in the sign's colours, and decoded here before it is
 * shown. One that does not decode is replaced by a plain dark-on-white code,
 * and the page says so, because a sign that looks right and does not scan is
 * the one failure this must never print.
 */

const QR_STYLE_LABELS: Record<QrStyle, string> = { classic: "Classic", dots: "Dots", rounded: "Rounded" };

/** The face each look's sample is set in, for the design tiles. */
const LOOK_FACES: Record<TemplateKey, string> = {
  "black-tie": "var(--font-bodoni), Didot, serif",
  "white-lace": "var(--font-pinyon), cursive",
  party: "var(--font-fredoka), ui-rounded, sans-serif",
  diploma: "var(--font-cinzel), serif",
  modern: "var(--font-space-grotesk), sans-serif",
  plain: "var(--font-fraunces), Georgia, serif",
};

const STORAGE_PREFIX = "klik:qr-sign:";

type Check = { svg: string; state: "checking" | "scans" | "fallback" };

const noSubscription = () => () => {};

/** The host's last sign for this event, on this device, as stored. */
function readSaved(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Draws the code and reads it back with a decoder, the way a phone would. */
async function decodesInBrowser(svg: string, expected: string): Promise<boolean> {
  try {
    const { default: jsQR } = await import("jsqr");
    const image = new Image();
    image.src = svgDataUri(svg);
    await image.decode();
    const side = 640;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, side, side);
    const { data } = context.getImageData(0, 0, side, side);
    return jsQR(data, side, side, { inversionAttempts: "dontInvert" })?.data === expected;
  } catch {
    return false;
  }
}

export function SignDesigner({
  eventId,
  eventName,
  url,
  eventDate,
  galleryLook,
  galleryColorway,
  galleryColors,
  fields,
  language,
  caps,
  backHref,
}: {
  eventId: string;
  eventName: string;
  url: string;
  eventDate: string | null;
  galleryLook: TemplateKey;
  galleryColorway: string | null;
  galleryColors: { accent: string; background: string };
  fields: TemplateFields | null;
  language: Locale;
  caps: SignCaps;
  backHref: string;
}) {
  const defaults = signDefaults({
    look: galleryLook,
    colorway: galleryColorway,
    caps,
    language,
    hasDate: Boolean(eventDate) && fields?.showDate !== false,
    hasMessage: signHasMessage(galleryLook, fields),
  });
  const storageKey = `${STORAGE_PREFIX}${eventId}`;
  // The server and the first render in the browser both draw the defaults;
  // the saved sign takes over straight after (useSyncExternalStore re-renders
  // once hydrated), and anything the host changes takes over from that.
  const saved = useSyncExternalStore(noSubscription, () => readSaved(storageKey), () => null);
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [edited, setEdited] = useState<SignOptions | null>(null);
  const options = edited ?? parseSaved(saved, defaults, caps);

  function update(patch: Partial<SignOptions>) {
    const next = cleanSignOptions({ ...options, ...patch }, defaults, caps);
    setEdited(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not remembered, which only costs the host their choices next time.
    }
  }

  function reset() {
    setEdited(defaults);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to forget.
    }
  }

  const look = templateByKey(options.look) ?? GALLERY_TEMPLATES[0];
  const paper = paperByKey(options.paper);
  const base = signBaseColors(look, options.colorway, galleryColors);
  const designed = signPalette(base, options.saveInk);
  const darkLook = !signPalette(base, false).light;

  const svg = styledQrSvg({ text: url, style: options.qrStyle, foreground: designed.qrInk, background: designed.qrCard, size: 1000 });
  const [check, setCheck] = useState<Check>({ svg, state: "checking" });
  useEffect(() => {
    let current = true;
    void decodesInBrowser(svg, url).then((ok) => {
      if (current) setCheck({ svg, state: ok ? "scans" : "fallback" });
    });
    return () => {
      current = false;
    };
  }, [svg, url]);
  const state = check.svg === svg ? check.state : "checking";
  const fallback = state === "fallback";
  const palette: SignPalette = fallback ? { ...designed, qrInk: "#050505", qrCard: "#ffffff" } : designed;
  const qrSvg = fallback
    ? styledQrSvg({ text: url, style: "classic", foreground: "#050505", background: "#ffffff", size: 1000 })
    : svg;

  const content = signContent({
    options,
    eventName,
    fields,
    dateLabel: formatLookDate(eventDate, look.key, options.language),
    url,
    palette,
    qrSrc: svgDataUri(qrSvg),
  });
  const defaultTitle = signContent({ options: { ...options, title: "" }, eventName, fields, dateLabel: null, url, palette, qrSrc: "" }).title;
  const hasMessage = signHasMessage(look.key, fields);
  // The host's own colours, offered only when they are not already one of
  // this look's colourways, which would put the same swatch up twice.
  const galleryIsColorway = look.colorways.some(
    (colorway) => colorway.accent === galleryColors.accent.toLowerCase() && colorway.background === galleryColors.background.toLowerCase(),
  );

  function chooseLook(key: TemplateKey) {
    const next = templateByKey(key);
    if (!next) return;
    const keepColours = options.colorway === GALLERY_COLORWAY;
    const galleryOne = galleryColorway && next.colorways.some((option) => option.key === galleryColorway) ? galleryColorway : null;
    update({ look: key, colorway: keepColours ? GALLERY_COLORWAY : (galleryOne ?? next.colorways[0].key) });
  }

  async function print() {
    try {
      await document.fonts.ready;
    } catch {
      // Print with whatever has loaded.
    }
    window.print();
  }

  const sheet = (physical: boolean) => (
    <div
      className="qs-sheet"
      data-per-page={options.perPage}
      style={
        physical
          ? { width: `${paper.widthMm}mm`, height: `${paper.heightMm}mm` }
          : { width: "100%", aspectRatio: `${paper.widthMm} / ${paper.heightMm}` }
      }
    >
      {Array.from({ length: options.perPage }, (_, index) => (
        <div key={index} className="qs-cell">
          <QrSign content={content} />
        </div>
      ))}
    </div>
  );

  return (
    <main className="qs-designer mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6 md:px-10">
      <style>{`@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 0; }`}</style>
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the event
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-paper sm:text-3xl">Print your QR sign</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        In your gallery&apos;s look, with your event&apos;s name on it. The sheet below is exactly what comes out of the printer.
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Preview" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div
            className="mx-auto overflow-hidden rounded-md shadow-[0_18px_50px_rgba(0,0,0,0.45)] ring-1 ring-canvas-line"
            style={{ width: `min(100%, calc((100dvh - 15rem) * ${paper.widthMm / paper.heightMm}))` }}
          >
            {sheet(false)}
          </div>

          <div className="mx-auto mt-5 flex max-w-xl flex-col items-center gap-3 text-center">
            <ScanStatus state={state} />
            <Button size="lg" onClick={() => void print()} disabled={state === "checking"} className="gap-2">
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </Button>
            <p className="text-xs leading-relaxed text-muted">
              In the print dialog, pick {paper.label} paper, set margins to none, and turn on background graphics if it
              asks. Choose Save as PDF to keep a file or send it to a print shop.
            </p>
          </div>
        </section>

        <aside aria-label="Sign options" className="space-y-8">
          <Group title="Design">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Design">
              {GALLERY_TEMPLATES.map((option) => {
                const selected = option.key === look.key;
                const colours =
                  options.colorway === GALLERY_COLORWAY
                    ? galleryColors
                    : selected
                      ? base
                      : option.colorways.find((colorway) => colorway.key === galleryColorway) ?? option.colorways[0];
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseLook(option.key)}
                    className={`group flex flex-col items-stretch gap-1.5 rounded-xl border p-1.5 text-left transition-colors ${
                      selected ? "border-volt" : "border-canvas-line hover:border-paper/40"
                    }`}
                  >
                    <span
                      className="grid aspect-[4/3] place-items-center rounded-lg text-2xl"
                      style={{ background: colours.background, color: colours.accent, fontFamily: LOOK_FACES[option.key] }}
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                    <span className="px-1 pb-0.5 text-xs leading-tight text-paper">
                      {option.key === "plain" ? "Klik" : option.name}
                      {option.key === galleryLook && <span className="block text-[11px] text-muted">Your gallery</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>

          <Group title="Colours">
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colours">
              {caps.galleryColors && !galleryIsColorway && (
                <Swatch
                  label="Your gallery's colours"
                  colours={galleryColors}
                  selected={options.colorway === GALLERY_COLORWAY}
                  onSelect={() => update({ colorway: GALLERY_COLORWAY })}
                />
              )}
              {look.colorways.map((colorway) => (
                <Swatch
                  key={colorway.key}
                  label={colorway.name}
                  colours={colorway}
                  selected={options.colorway === colorway.key}
                  onSelect={() => update({ colorway: colorway.key })}
                />
              ))}
            </div>
            <div className="mt-3">
              <Checkbox
                checked={options.saveInk && darkLook}
                disabled={!darkLook}
                onChange={(event) => update({ saveInk: event.target.checked })}
                hint={darkLook ? "Keeps the design, drops the dark background. Kinder to a home printer." : "This one is already light."}
              >
                Print on white to save ink
              </Checkbox>
            </div>
          </Group>

          <Group title="Words">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs text-muted">Title</span>
                <input
                  className={inputClass}
                  value={options.title}
                  maxLength={SIGN_TITLE_MAX}
                  placeholder={defaultTitle}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <div>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-muted">Over the code</span>
                  <input
                    className={inputClass}
                    value={options.headline}
                    maxLength={SIGN_HEADLINE_MAX}
                    placeholder={SIGN_COPY[options.language].headlines[0]}
                    onChange={(event) => update({ headline: event.target.value })}
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SIGN_COPY[options.language].headlines.map((headline) => (
                    <button
                      key={headline}
                      type="button"
                      onClick={() => update({ headline })}
                      className="min-h-8 rounded-full border border-canvas-line px-3 text-xs text-muted transition-colors hover:border-paper/40 hover:text-paper"
                    >
                      {headline}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-xs text-muted">Language</span>
                <Chips
                  label="Language"
                  value={options.language}
                  options={LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))}
                  onChange={(value) =>
                    // A preset in the old language follows into the new one.
                    update({
                      language: value,
                      headline: presetIndex(options) >= 0 ? SIGN_COPY[value].headlines[presetIndex(options)] : options.headline,
                    })
                  }
                />
              </div>
            </div>
          </Group>

          <Group title="QR code">
            <Chips
              label="QR code style"
              value={options.qrStyle}
              options={QR_STYLES.map((style) => ({ value: style, label: QR_STYLE_LABELS[style], disabled: !caps.qrStyles && style !== "classic" }))}
              onChange={(value) => update({ qrStyle: value })}
            />
            {!caps.qrStyles && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Dots and rounded codes come with Klik Premium.
              </p>
            )}
          </Group>

          <Group title="On the sign">
            <div className="space-y-0.5">
              <Checkbox
                checked={options.showDate && Boolean(eventDate)}
                disabled={!eventDate}
                onChange={(event) => update({ showDate: event.target.checked })}
                hint={eventDate ? undefined : "The event has no date yet."}
              >
                The date
              </Checkbox>
              <Checkbox
                checked={options.showMessage && hasMessage}
                disabled={!hasMessage}
                onChange={(event) => update({ showMessage: event.target.checked })}
                hint={hasMessage ? undefined : "Write one on the event's Look tab."}
              >
                Your message
              </Checkbox>
              <Checkbox checked={options.showSteps} onChange={(event) => update({ showSteps: event.target.checked })}>
                How it works, in three steps
              </Checkbox>
              <Checkbox checked={options.showAddress} onChange={(event) => update({ showAddress: event.target.checked })}>
                The gallery address, for anyone who cannot scan
              </Checkbox>
              <Checkbox
                checked={options.showLogo}
                disabled={!caps.hideLogo}
                onChange={(event) => update({ showLogo: event.target.checked })}
                hint={caps.hideLogo ? undefined : "Klik Premium can take it off."}
              >
                The Klik logo
              </Checkbox>
            </div>
          </Group>

          <Group title="Paper">
            <Chips
              label="Paper size"
              value={options.paper}
              options={SIGN_PAPERS.map((option) => ({ value: option.key, label: option.label }))}
              onChange={(value) => update({ paper: value })}
            />
            <div className="mt-3">
              <Chips
                label="Signs per page"
                value={String(options.perPage)}
                options={[
                  { value: "1", label: "One per page" },
                  { value: "4", label: "Four table cards", disabled: !paper.sheet },
                ]}
                onChange={(value) => update({ perPage: value === "4" ? 4 : 1 })}
              />
              <p className="mt-2 text-xs text-muted">
                {paper.sheet
                  ? options.perPage === 4
                    ? "Four smaller signs on one sheet, with light lines to cut along."
                    : "One sign filling the sheet."
                  : "Four to a page works on A4 and Letter."}
              </p>
            </div>
          </Group>

          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Start again from the gallery&apos;s look
          </button>
        </aside>
      </div>

      {mounted && createPortal(<div className="qs-print-root">{sheet(true)}</div>, document.body)}
    </main>
  );
}

function parseSaved(saved: string | null, defaults: SignOptions, caps: SignCaps): SignOptions {
  if (!saved) return defaults;
  try {
    return cleanSignOptions(JSON.parse(saved), defaults, caps);
  } catch {
    return defaults;
  }
}

/** Which preset the headline is, so it can follow a change of language. */
function presetIndex(options: SignOptions): number {
  return SIGN_COPY[options.language].headlines.indexOf(options.headline);
}

function ScanStatus({ state }: { state: Check["state"] }) {
  if (state === "checking") return <p className="text-xs text-muted">Checking that the code scans…</p>;
  if (state === "scans") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-paper">
        <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
        Checked: the code scans
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-paper" role="status">
      <TriangleAlert className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
      The styled code did not scan in these colours, so this sign uses a plain black one.
    </p>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({
  label,
  colours,
  selected,
  onSelect,
}: {
  label: string;
  colours: { accent: string; background: string };
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={`grid h-11 w-11 place-items-center rounded-full border-2 transition-colors ${
        selected ? "border-volt" : "border-transparent hover:border-paper/40"
      }`}
    >
      <span
        className="h-8 w-8 rounded-full ring-1 ring-canvas-line"
        style={{ background: `linear-gradient(135deg, ${colours.background} 50%, ${colours.accent} 50%)` }}
      />
    </button>
  );
}

function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-10 rounded-full border px-3.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            value === option.value
              ? "border-transparent bg-volt text-on-volt"
              : "border-canvas-line text-muted hover:text-paper"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
