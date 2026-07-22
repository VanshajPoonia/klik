/**
 * Client-side "looks" for the in-app camera. Event photos are usually shot in
 * unforgiving light, so the default is a genuine auto-enhance (histogram
 * auto-levels + a gentle saturation lift) rather than a flat capture.
 *
 * Each look is defined once as numeric adjustments. Those drive three surfaces
 * from a single source of truth:
 *   - the live <video> preview and filtered video recording, via a CSS filter
 *     string (GPU-accelerated where supported);
 *   - the saved photo, via an exact pixel pass so the look bakes in identically
 *     on every browser, including ones without canvas `ctx.filter`.
 */

export type LookId = "auto" | "original" | "vivid" | "warm" | "noir" | "film";

export interface Adjustments {
  brightness?: number;
  contrast?: number;
  saturate?: number;
  sepia?: number;
  grayscale?: number;
}

export interface Look {
  id: LookId;
  label: string;
  adjust: Adjustments;
  /** CSS filter string derived from `adjust`, for preview + video recording. */
  preview: string;
  /** When true, the saved photo also gets the histogram auto-levels pass. */
  enhance?: boolean;
}

/** Builds a CSS filter string from adjustments, in the same order the pixel
 * pass applies them so preview and saved file agree. */
export function cssFilter(a: Adjustments): string {
  const parts: string[] = [];
  if (a.grayscale) parts.push(`grayscale(${a.grayscale})`);
  if (a.sepia) parts.push(`sepia(${a.sepia})`);
  if (a.saturate !== undefined && a.saturate !== 1) parts.push(`saturate(${a.saturate})`);
  if (a.contrast !== undefined && a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
  if (a.brightness !== undefined && a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
  return parts.length ? parts.join(" ") : "none";
}

function look(id: LookId, label: string, adjust: Adjustments, enhance?: boolean): Look {
  return { id, label, adjust, preview: cssFilter(adjust), enhance };
}

export const LOOKS: Look[] = [
  // `adjust` here is only the preview/video approximation; the saved photo uses
  // the histogram auto-levels pass instead (enhance).
  look("auto", "Auto", { contrast: 1.05, saturate: 1.1, brightness: 1.02 }, true),
  look("original", "Original", {}),
  look("vivid", "Vivid", { saturate: 1.35, contrast: 1.12 }),
  look("warm", "Warm", { sepia: 0.25, saturate: 1.2, contrast: 1.05, brightness: 1.03 }),
  look("noir", "Noir", { grayscale: 1, contrast: 1.2 }),
  look("film", "Film", { sepia: 0.32, saturate: 0.85, contrast: 0.95, brightness: 1.05 }),
];

export const DEFAULT_LOOK: LookId = "auto";

export function lookById(id: LookId): Look {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0];
}

/** Whether canvas 2D contexts support the `filter` property (for filtered video
 * recording). Safari gained it in 16.4; older engines fall back to raw video. */
let ctxFilterCache: boolean | undefined;
export function supportsCtxFilter(): boolean {
  if (ctxFilterCache !== undefined) return ctxFilterCache;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctxFilterCache = Boolean(ctx) && "filter" in ctx!;
  } catch {
    ctxFilterCache = false;
  }
  return ctxFilterCache;
}

/**
 * Applies a look's adjustments to a canvas as pure pixel math, so the saved
 * photo carries the look regardless of `ctx.filter` support. Operations are
 * ordered to match `cssFilter`. Writes to a Uint8ClampedArray, which clamps for
 * us on assignment.
 */
export function applyAdjustments(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  a: Adjustments,
): void {
  const gray = a.grayscale ?? 0;
  const sepia = a.sepia ?? 0;
  const sat = a.saturate ?? 1;
  const con = a.contrast ?? 1;
  const bri = a.brightness ?? 1;
  if (!gray && !sepia && sat === 1 && con === 1 && bri === 1) return;

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch {
    return;
  }
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    if (gray) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r += (l - r) * gray;
      g += (l - g) * gray;
      b += (l - b) * gray;
    }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia;
      g += (sg - g) * sepia;
      b += (sb - b) * sepia;
    }
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    if (con !== 1) {
      r = (r - 128) * con + 128;
      g = (g - 128) * con + 128;
      b = (b - 128) * con + 128;
    }
    if (bri !== 1) {
      r *= bri;
      g *= bri;
      b *= bri;
    }

    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
}

const SATURATION = 1.12;

/**
 * Auto-levels: stretches the luminance range between its 0.5th and 99.5th
 * percentiles so shadows and highlights use the full range, then lifts
 * saturation slightly. Hue is preserved (the same stretch maps every channel),
 * so it corrects exposure and flatness without introducing color casts. A
 * near-flat image is left alone to avoid amplifying noise.
 */
export function autoEnhance(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch {
    return; // Tainted canvas (shouldn't happen for a same-origin camera).
  }
  const data = image.data;
  const pixelCount = width * height;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    histogram[lum | 0]++;
  }

  const cut = Math.max(1, Math.floor(pixelCount * 0.005));
  let low = 0;
  let high = 255;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += histogram[v];
    if (acc > cut) {
      low = v;
      break;
    }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += histogram[v];
    if (acc > cut) {
      high = v;
      break;
    }
  }

  const stretch = high - low > 8;
  const scale = stretch ? 255 / (high - low) : 1;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = stretch ? (v - low) * scale : v;
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = lut[data[i]];
    const g = lut[data[i + 1]];
    const b = lut[data[i + 2]];
    const l = (r * 299 + g * 587 + b * 114) / 1000;
    data[i] = l + (r - l) * SATURATION;
    data[i + 1] = l + (g - l) * SATURATION;
    data[i + 2] = l + (b - l) * SATURATION;
  }

  ctx.putImageData(image, 0, 0);
}
