import { describe, expect, it } from "vitest";
import { enhancePixels } from "./image-enhance";

const W = 64;
const H = 64;

/** An RGBA image from a function of (x, y) to [r, g, b]. */
function image(paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

function region(data: Uint8ClampedArray, x0: number, x1: number, y0 = 0, y1 = H) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      sums[0] += data[i];
      sums[1] += data[i + 1];
      sums[2] += data[i + 2];
      count++;
    }
  }
  return sums.map((sum) => sum / count);
}

const luma = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
/** A small deterministic noise source, so tests do not flake. */
const noise = (x: number, y: number, seed: number) => ((Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453) % 1) * 2 - 1;

describe("AI-5 on-device enhancement", () => {
  it("leaves a well exposed, neutral photo nearly as it was", () => {
    const original = image((x) => {
      const v = Math.round(10 + (x / (W - 1)) * 235);
      return [v, v, v];
    });
    const out = Uint8ClampedArray.from(original);
    enhancePixels(out, W, H);
    let difference = 0;
    for (let i = 0; i < out.length; i += 4) difference += Math.abs(out[i] - original[i]);
    expect(difference / (W * H)).toBeLessThan(8);
  });

  it("takes part of a blue cast off grey things", () => {
    // A grey wall and a white shirt under bluish light, with a dark corner for range.
    const data = image((x, y) => (x < 8 && y < 8 ? [5, 5, 8] : x < 40 ? [118, 128, 150] : [205, 214, 238]));
    const before = region(data, 10, 38);
    enhancePixels(data, W, H);
    const after = region(data, 10, 38);
    const spread = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb);
    expect(spread(after)).toBeLessThan(spread(before) * 0.85);
  });

  it("keeps candlelight warm: a strong cast is not mistaken for a mistake", () => {
    const data = image((x, y) => (x < 8 && y < 8 ? [6, 3, 1] : x < 40 ? [190, 120, 50] : [240, 170, 90]));
    enhancePixels(data, W, H);
    const [r, , b] = region(data, 10, 38);
    expect(r - b).toBeGreaterThan(100);
  });

  it("lifts a dark room without clipping it, and leaves a green lawn green", () => {
    const dark = image((x) => {
      const v = Math.round(4 + (x / (W - 1)) * 70);
      return [v, v, v];
    });
    const before = luma(region(dark, 0, W));
    enhancePixels(dark, W, H);
    const after = region(dark, 0, W);
    expect(luma(after)).toBeGreaterThan(before * 1.5);
    expect(luma(region(dark, W - 4, W))).toBeLessThanOrEqual(255);
    expect(luma(region(dark, 0, 4))).toBeLessThan(30);

    const lawn = image((x) => [40 + x, 120 + x, 30 + (x >> 1)]);
    enhancePixels(lawn, W, H);
    const [r, g, b] = region(lawn, 0, W);
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
  });

  it("smooths colour blotches in a dark photo and keeps its edges sharp", () => {
    // A dark scene with a hard brightness edge, and colour noise on top.
    const paint = (x: number, y: number): [number, number, number] => {
      const base = x < W / 2 ? 30 : 90;
      return [base + noise(x, y, 1) * 14, base + noise(x, y, 2) * 4, base + noise(x, y, 3) * 14];
    };
    const data = image(paint);
    const colourSpread = (pixels: Uint8ClampedArray, x0: number, x1: number) => {
      let sum = 0;
      let count = 0;
      for (let y = 4; y < H - 4; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          sum += Math.abs(pixels[i] - pixels[i + 2]);
          count++;
        }
      }
      return sum / count;
    };
    const noisy = Uint8ClampedArray.from(data);
    enhancePixels(data, W, H);
    // Compared with the same correction minus nothing: the red-blue blotches shrink.
    expect(colourSpread(data, 4, W / 2 - 4)).toBeLessThan(colourSpread(noisy, 4, W / 2 - 4));
    // The brightness step is still a step, a pixel wide, not a ramp.
    const left = luma(region(data, W / 2 - 2, W / 2 - 1, 8, H - 8));
    const right = luma(region(data, W / 2, W / 2 + 1, 8, H - 8));
    expect(right - left).toBeGreaterThan(60);
  });

  it("leaves a nearly flat frame alone rather than stretching its noise", () => {
    const flat = image((x, y) => {
      const v = 100 + Math.round(noise(x, y, 4) * 2);
      return [v, v, v];
    });
    const original = Uint8ClampedArray.from(flat);
    enhancePixels(flat, W, H);
    let difference = 0;
    for (let i = 0; i < flat.length; i += 4) difference += Math.abs(flat[i] - original[i]);
    expect(difference / (W * H)).toBeLessThan(3);
  });
});
