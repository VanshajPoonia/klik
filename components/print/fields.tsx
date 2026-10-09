"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The studio's small controls, sized for a side panel. A number field keeps
 * what is being typed as text and commits only a number, so clearing a field
 * to type a new value does not first set it to zero.
 */

const fieldBase =
  "rounded-lg border border-canvas-line bg-canvas px-2 py-1.5 text-xs text-paper tabular-nums focus:border-volt/60 focus:outline-none focus:ring-1 focus:ring-volt/60 disabled:opacity-50";
const fieldShell = `w-full ${fieldBase}`;

export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  disabled,
  decimals = 1,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  decimals?: number;
}) {
  const id = useId();
  const shown = String(Math.round(value * 10 ** decimals) / 10 ** decimals);
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  const commit = (raw: string) => {
    const parsed = Number(raw.replace(",", "."));
    if (raw.trim() !== "" && Number.isFinite(parsed)) onCommit(clamp(parsed));
  };
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <span className="relative block">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft ?? shown}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setDraft(event.target.value);
            commit(event.target.value);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next = clamp(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
              setDraft(null);
              onCommit(next);
            }
          }}
          className={`${fieldShell} ${suffix ? "pr-8" : ""}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({
  label,
  value,
  onChange,
  swatches,
  allowNone = false,
  noneLabel = "None",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  swatches: string[];
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div>
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={`h-7 rounded-full border px-2.5 text-[11px] ${value === null ? "border-volt text-volt" : "border-canvas-line text-muted hover:text-paper"}`}
          >
            {noneLabel}
          </button>
        )}
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange(swatch)}
            aria-label={`Use ${swatch}`}
            aria-pressed={value?.toLowerCase() === swatch.toLowerCase()}
            className={`h-7 w-7 rounded-full border ${value?.toLowerCase() === swatch.toLowerCase() ? "ring-2 ring-volt ring-offset-2 ring-offset-canvas-raised" : ""} border-canvas-line`}
            style={{ backgroundColor: swatch }}
          />
        ))}
        <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-dashed border-muted" title="Any colour">
          <span className="sr-only">Pick any colour for {label.toLowerCase()}</span>
          <input
            type="color"
            value={value ?? "#000000"}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">+</span>
        </label>
        <input
          id={id}
          aria-label={`${label}, as a hex code`}
          value={draft ?? value ?? ""}
          placeholder="#000000"
          onChange={(event) => {
            setDraft(event.target.value);
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            if (HEX.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
          className={`${fieldBase} w-[5.5rem] font-mono`}
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <div className="flex rounded-lg border border-canvas-line p-0.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-label={option.title}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`flex min-h-8 flex-1 items-center justify-center rounded-md px-2 text-xs transition-colors ${
              value === option.value ? "bg-canvas-line text-paper" : "text-muted hover:text-paper"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-canvas-line px-4 py-4 last:border-b-0">
      <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
