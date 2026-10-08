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
