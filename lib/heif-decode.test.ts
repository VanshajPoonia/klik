import { describe, expect, it } from "vitest";
import { isHeif } from "./heif-decode";

/** An ISO base media header with this brand, as the first bytes of a file. */
function ftyp(brand: string): Blob {
  const bytes = new Uint8Array(32);
  bytes.set([0, 0, 0, 0x20], 0);
  bytes.set([..."ftyp"].map((c) => c.charCodeAt(0)), 4);
  bytes.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return new Blob([bytes]);
}

describe("isHeif", () => {
  it("recognises an iPhone's HEIC and a Samsung's HEIF", async () => {
    expect(await isHeif(ftyp("heic"))).toBe(true);
    expect(await isHeif(ftyp("mif1"))).toBe(true);
  });

  it("leaves AVIF, which browsers decode themselves, and anything else alone", async () => {
    expect(await isHeif(ftyp("avif"))).toBe(false);
    expect(await isHeif(ftyp("qt  "))).toBe(false);
    expect(await isHeif(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toBe(false);
  });
});
