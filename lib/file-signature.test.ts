import { describe, expect, it } from "vitest";
import { SIGNATURE_BYTES, detectMediaSignature } from "./file-signature";

/**
 * SEC-9, pinned.
 *
 * The finding was not theoretical: verified against the live bucket, R2 signs
 * `Content-Type` but does not enforce it, so a URL presigned for `image/jpeg`
 * returned 200 for a ZIP body. The declared type is a label and this reads the
 * bytes, so every case below is a file someone could actually push through a
 * legitimately obtained upload URL.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

/** An ISO base media header: four length bytes, "ftyp", then the brand. */
const isoContainer = (brand: string) =>
  new Uint8Array([0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0]);

const pad = (head: number[]) =>
  new Uint8Array([...head, ...new Array(Math.max(0, SIGNATURE_BYTES - head.length)).fill(0)]);

describe("formats a gallery can display", () => {
  it.each([
    ["jpeg", pad([0xff, 0xd8, 0xff, 0xe0]), "image", "jpeg"],
    ["png", pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image", "png"],
    ["webp", pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]), "image", "webp"],
    ["webm", pad([0x1a, 0x45, 0xdf, 0xa3]), "video", "webm"],
  ])("detects %s", (_label, input, family, format) => {
    expect(detectMediaSignature(input)).toEqual({ family, format });
  });

  it.each(["heic", "heix", "mif1", "avif", "avis"])(
    "treats the ISO brand %j as a still image",
    (brand) => {
      expect(detectMediaSignature(isoContainer(brand))?.family).toBe("image");
    },
  );

  it.each(["isom", "mp42", "avc1", "qt  ", "M4V "])(
    "treats the ISO brand %j as video",
    (brand) => {
      expect(detectMediaSignature(isoContainer(brand))?.family).toBe("video");
    },
  );

  // An iPhone .mov and a HEIC photo share a container and differ only by brand,
  // which is the entire reason this is not done by file extension.
  it("separates a QuickTime movie from a HEIC photo by brand alone", () => {
    expect(detectMediaSignature(isoContainer("qt  "))?.family).toBe("video");
    expect(detectMediaSignature(isoContainer("heic"))?.family).toBe("image");
  });
});

describe("everything else is refused", () => {
  it.each([
    ["a zip, the original SEC-9 proof", [0x50, 0x4b, 0x03, 0x04]],
    ["a pdf", ascii("%PDF-1.7")],
    ["html", ascii("<!DOCTYPE html>")],
    ["an ELF binary", [0x7f, 0x45, 0x4c, 0x46]],
    ["a windows executable", ascii("MZ")],
    ["a wav, which RIFF would otherwise match", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]],
    ["an avi, also RIFF", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")]],
    ["a gzip", [0x1f, 0x8b, 0x08]],
    ["a shell script", ascii("#!/bin/sh\n")],
    ["an svg, which is xml and can carry script", ascii("<svg xmlns=")],
    ["plain text", ascii("just some words")],
  ])("rejects %s", (_label, head) => {
    expect(detectMediaSignature(pad(head))).toBeNull();
  });

  it.each([
    ["nothing at all", bytes()],
    ["a single byte", bytes(0xff)],
    ["a truncated jpeg marker", bytes(0xff, 0xd8)],
    ["a truncated png header", bytes(0x89, 0x50, 0x4e)],
    ["RIFF with no form type", new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0])],
  ])("handles %s without throwing", (_label, input) => {
    expect(() => detectMediaSignature(input)).not.toThrow();
    expect(detectMediaSignature(input)).toBeNull();
  });
});

describe("the unknown-brand decision", () => {
  /**
   * A deliberate trade, documented in the module and pinned here so it cannot
   * be changed by accident. Phone vendors invent `ftyp` brands, and refusing a
   * guest's genuine recording at a wedding is worse than storing a container
   * we could not name precisely. It is safe because the brand still had to
   * appear inside a real ISO header.
   */
  it("accepts an unrecognised ISO brand as video rather than refusing it", () => {
    expect(detectMediaSignature(isoContainer("zzzz"))).toEqual({
      family: "video",
      format: "iso:zzzz",
    });
  });

  it("does not extend that leniency to non-ISO containers", () => {
    expect(detectMediaSignature(pad(ascii("NOTAfileZZZZ")))).toBeNull();
  });
});

describe("SIGNATURE_BYTES", () => {
  // The route issues a ranged read of exactly this many bytes, so if a longer
  // signature is ever added the read has to grow with it.
  it("is enough to reach the ftyp brand", () => {
    expect(SIGNATURE_BYTES).toBeGreaterThanOrEqual(12);
    const brandOnly = isoContainer("heic").subarray(0, SIGNATURE_BYTES);
    expect(detectMediaSignature(brandOnly)?.family).toBe("image");
  });
});
