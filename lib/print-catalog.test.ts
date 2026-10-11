import { describe, expect, it } from "vitest";
import { PRINT_PRODUCTS, printDpi, printQuality, productByKey } from "./print-catalog";
import { chooseAttributes, trackingOf } from "./prodigi";

describe("how sharp a print will be", () => {
  it("turns the photo to suit the paper", () => {
    const fourBySix = productByKey("4x6")!;
    // A 2560 by 1707 landscape photo on a 6 by 4 inch print.
    expect(printDpi(2560, 1707, fourBySix)).toBe(426);
    // The same photo upright gives the same answer.
    expect(printDpi(1707, 2560, fourBySix)).toBe(426);
  });

  it("grades it, and says nothing when the size is unknown", () => {
    const eightByTen = productByKey("8x10")!;
    expect(printQuality(printDpi(2560, 1920, eightByTen))).toBe("good");
    expect(printQuality(printDpi(1080, 810, eightByTen))).toBe("soft");
    expect(printQuality(printDpi(4096, 3072, eightByTen))).toBe("great");
    expect(printQuality(printDpi(null, 100, eightByTen))).toBe("unknown");
  });

  it("offers three sizes, cheapest first, priced in whole cents", () => {
    expect(PRINT_PRODUCTS.map((product) => product.key)).toEqual(["4x6", "5x7", "8x10"]);
    for (const product of PRINT_PRODUCTS) expect(Number.isInteger(product.priceCents)).toBe(true);
    expect(productByKey("poster")).toBeNull();
  });
});

describe("Prodigi's options", () => {
  it("prefer lustre where it is offered, and take the first of anything else required", () => {
    expect(chooseAttributes({ attributes: { finish: ["gloss", "lustre"], border: ["none", "white"] } }, { finish: "lustre" })).toEqual({
      finish: "lustre",
      border: "none",
    });
    expect(chooseAttributes({ attributes: { finish: ["gloss"] } }, { finish: "lustre" })).toEqual({ finish: "gloss" });
    expect(chooseAttributes({ attributes: {} })).toEqual({});
  });

  it("read tracking only where there is a number or a link", () => {
    expect(
      trackingOf({
        shipments: [
          { carrier: { name: "USPS" }, tracking: { number: "9400", url: "https://track.example/9400" } },
          { carrier: { name: "UPS" }, tracking: {} },
        ],
      }),
    ).toEqual([{ carrier: "USPS", number: "9400", url: "https://track.example/9400" }]);
  });
});
