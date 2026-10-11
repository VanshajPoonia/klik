/**
 * GRW-6: what Klik prints and for how much, in a module the browser can
 * import (the gallery shows sizes, prices and how sharp each will be). The
 * ordering itself is lib/prints.ts.
 */

export interface PrintProduct {
  key: "4x6" | "5x7" | "8x10";
  label: string;
  sku: string;
  /** Long and short edge, inches. */
  inches: [number, number];
  priceCents: number;
}

/**
 * Prodigi's C-type silver halide prints, lustre where offered. Retail prices
 * are Klik's and sit comfortably over Prodigi's cost so a small order does
 * not lose money after Stripe's fee; ROADMAP.md section C. A SKU can be
 * overridden on the server by `PRODIGI_SKU_4X6` and friends without a
 * deploy (`skuOf` in lib/prints.ts), and `/admin`'s catalogue check says
 * whether each one exists.
 */
export const PRINT_PRODUCTS: readonly PrintProduct[] = [
  { key: "4x6", label: "4×6 in", sku: "GLOBAL-PHO-4X6", inches: [6, 4], priceCents: 299 },
  { key: "5x7", label: "5×7 in", sku: "GLOBAL-PHO-5X7-PRO", inches: [7, 5], priceCents: 599 },
  { key: "8x10", label: "8×10 in", sku: "GLOBAL-PHO-8X10-PRO", inches: [10, 8], priceCents: 1299 },
];

export const PREFERRED_ATTRIBUTES = { finish: "lustre" };
export const SHIPPING_CENTS = 599;
export const MAX_ORDER_LINES = 50;
export const MAX_COPIES = 20;
/** Address and email are kept this long after an order closes, for returns and disputes. */
export const REDACT_AFTER_DAYS = 120;

export function productByKey(key: string): PrintProduct | null {
  return PRINT_PRODUCTS.find((product) => product.key === key) ?? null;
}

/**
 * How sharp a photo prints at a size, in dots per inch with the photo turned
 * to suit the paper. 250 and up is as good as the paper; under 150 shows.
 */
export function printDpi(width: number | null, height: number | null, product: Pick<PrintProduct, "inches">): number | null {
  if (!width || !height) return null;
  const [long, short] = product.inches;
  return Math.floor(Math.min(Math.max(width, height) / long, Math.min(width, height) / short));
}

export function printQuality(dpi: number | null): "great" | "good" | "soft" | "unknown" {
  if (dpi === null) return "unknown";
  if (dpi >= 250) return "great";
  if (dpi >= 150) return "good";
  return "soft";
}
