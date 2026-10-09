/**
 * QR-4: the sizes a design can be. Everything in the studio is in millimetres,
 * the unit a printer works in; inches appear only in the names people know a
 * size by. A digital size (a story) is drawn the same way and exported at an
 * exact pixel size instead of a print resolution, with no bleed.
 */

export interface PrintPreset {
  key: string;
  label: string;
  widthMm: number;
  heightMm: number;
  /** Extra background past the cut on every side. 3 mm is the trade default. */
  bleedMm: number;
  /** Exported at this exact pixel size, as a PNG, for a screen. */
  pixels?: { width: number; height: number };
}

export const STANDARD_BLEED_MM = 3;

/** Inside this margin from the cut, text and codes risk being trimmed. */
export const SAFE_MARGIN_MM = 3;

const inches = (value: number) => Math.round(value * 25.4 * 10) / 10;

export const PRINT_PRESETS: PrintPreset[] = [
  { key: "a4", label: "A4 poster", widthMm: 210, heightMm: 297, bleedMm: STANDARD_BLEED_MM },
  { key: "a3", label: "A3 poster", widthMm: 297, heightMm: 420, bleedMm: STANDARD_BLEED_MM },
  { key: "a5", label: "A5 flyer", widthMm: 148, heightMm: 210, bleedMm: STANDARD_BLEED_MM },
  { key: "sign-18x24", label: "Welcome sign, 18 × 24 in", widthMm: inches(18), heightMm: inches(24), bleedMm: STANDARD_BLEED_MM },
  { key: "sign-8x10", label: "Bar sign, 8 × 10 in", widthMm: inches(8), heightMm: inches(10), bleedMm: STANDARD_BLEED_MM },
  { key: "card-4x6", label: "Table card, 4 × 6 in", widthMm: inches(4), heightMm: inches(6), bleedMm: STANDARD_BLEED_MM },
  { key: "menu-4x9", label: "Menu insert, 4 × 9 in", widthMm: inches(4), heightMm: inches(9), bleedMm: STANDARD_BLEED_MM },
  { key: "card-5x7", label: "Card, 5 × 7 in", widthMm: inches(5), heightMm: inches(7), bleedMm: STANDARD_BLEED_MM },
  { key: "place-card", label: "Place card, 3.5 × 2 in", widthMm: inches(3.5), heightMm: inches(2), bleedMm: STANDARD_BLEED_MM },
  // Printed on sticker paper and cut by the sheet's own die, so nothing bleeds.
  { key: "sticker-sheet", label: "Sticker sheet, A4", widthMm: 210, heightMm: 297, bleedMm: 0 },
  { key: "story", label: "Instagram story", widthMm: 90, heightMm: 160, bleedMm: 0, pixels: { width: 1080, height: 1920 } },
];

export const CUSTOM_PRESET_KEY = "custom";
export const MIN_CUSTOM_MM = 40;
export const MAX_CUSTOM_MM = 1000;

export function findPreset(key: string): PrintPreset | null {
  return PRINT_PRESETS.find((preset) => preset.key === key) ?? null;
}

/** The size a design is, from its own columns, which a custom size sets. */
export interface DesignSize {
  preset: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
}

export function isDigital(size: Pick<DesignSize, "preset">): boolean {
  return Boolean(findPreset(size.preset)?.pixels);
}

/** "21 × 29.7 cm", the size as a person reads it. */
export function describeSize(size: Pick<DesignSize, "widthMm" | "heightMm">): string {
  const cm = (mm: number) => String(Math.round(mm) / 10);
  return `${cm(size.widthMm)} × ${cm(size.heightMm)} cm`;
}
