const HEX = /^#([0-9a-f]{6})$/i;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color. Falls back to dark on bad input. */
export function relativeLuminance(hex: string): number {
  const match = HEX.exec(hex);
  if (!match) return 0;
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Luminance where black and white text have equal contrast. Above it, dark
 * text reads better; below it, light text does. */
const CONTRAST_CROSSOVER = 0.18;

export function isLightColor(hex: string): boolean {
  return relativeLuminance(hex) > CONTRAST_CROSSOVER;
}

/** The text color (near-black or white) that reads best on top of `hex`. */
export function readableOn(hex: string): string {
  return isLightColor(hex) ? "#050505" : "#ffffff";
}

/** WCAG contrast ratio between two #rrggbb colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt((HEX.exec(hex)?.[1] ?? "000000"), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `hex` moved `amount` (0 to 1) of the way toward `target`, in sRGB. */
export function mixToward(hex: string, target: string, amount: number): string {
  const [a, b] = [rgb(hex), rgb(target)];
  return toHex(a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
}

/**
 * TRS-3: `foreground` nudged toward black or white, whichever reads better on
 * `background`, just far enough to reach `minimum` contrast. Keeps the hue a
 * host chose wherever it already passes, and changes as little as it can
 * where it does not.
 */
export function ensureContrast(foreground: string, background: string, minimum: number): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground.toLowerCase();
  // Both ways, and the smaller change wins: a yellow on mid grey reads once it
  // is a touch paler, where darkening it far enough would turn it olive.
  const preferred = isLightColor(background) ? "#000000" : "#ffffff";
  const other = preferred === "#000000" ? "#ffffff" : "#000000";
  for (let step = 1; step <= 40; step += 1) {
    for (const target of [preferred, other]) {
      const candidate = mixToward(foreground, target, step / 40);
      if (contrastRatio(candidate, background) >= minimum) return candidate;
    }
  }
  return contrastRatio(preferred, background) >= contrastRatio(other, background) ? preferred : other;
}

/**
 * TRS-3: the colours a gallery actually uses for a host's accent and
 * background, each held to WCAG AA against what it sits on: body text 7:1
 * where the background allows it and never under 4.5:1 (a mid grey tops out
 * near 6:1 even with black), secondary text 4.5:1, the accent 3:1 where it is
 * an icon, a link or a button edge, and a button's label 4.5:1 on the accent.
 * Shared by the gallery and the settings preview, so the preview is the truth.
 */
export function galleryPalette(accent: string, background: string) {
  const light = isLightColor(background);
  const paper = ensureContrast(light ? "#141412" : "#f3f1e9", background, 7);
  const muted = ensureContrast(light ? "#5c5a52" : "#a3a196", background, 4.5);
  const volt = ensureContrast(accent, background, 3);
  return {
    paper,
    muted,
    volt,
    onVolt: readableOn(volt),
    /** The accent had to change to be readable here. */
    accentAdjusted: volt !== accent.toLowerCase(),
    light,
  };
}
