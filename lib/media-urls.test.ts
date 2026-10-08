import { describe, expect, it } from "vitest";
import { SIGNING_WINDOW_MS, signMediaUrls, signingWindow } from "./media-urls";

const photo = {
  kind: "photo" as const,
  mimeType: "image/jpeg",
  blobPathname: "events/e/p.jpg",
  posterPathname: null,
  thumbPathname: "events/e/p-thumb.jpg",
};

describe("signingWindow", () => {
  it("rounds down to the window and stays valid for two of them", () => {
    const start = Date.parse("2026-10-08T12:00:00Z");
    const { signingDate, expiresIn } = signingWindow(start + 14 * 60 * 1000);
    expect(signingDate.getTime()).toBe(start);
    expect(expiresIn * 1000).toBe(2 * SIGNING_WINDOW_MS);
  });
});

describe("signMediaUrls", () => {
  it("returns the same URLs for every request inside one window, so browsers can cache them", async () => {
    const start = Date.parse("2026-10-08T12:00:00Z");
    const early = await signMediaUrls(photo, start + 1_000);
    const late = await signMediaUrls(photo, start + SIGNING_WINDOW_MS - 1_000);
    expect(late).toEqual(early);
  });

  it("issues fresh URLs in the next window", async () => {
    const start = Date.parse("2026-10-08T12:00:00Z");
    const one = await signMediaUrls(photo, start);
    const two = await signMediaUrls(photo, start + SIGNING_WINDOW_MS);
    expect(two.src).not.toEqual(one.src);
  });

  it("points a tile at the thumbnail and the lightbox at the photo", async () => {
    const urls = await signMediaUrls(photo);
    expect(urls.thumbSrc).toContain("p-thumb.jpg");
    expect(urls.src).toContain("/p.jpg");
    expect(urls.src).not.toContain("thumb");
  });

  it("falls back to the full photo for a tile when there is no thumbnail yet", async () => {
    const urls = await signMediaUrls({ ...photo, thumbPathname: null });
    expect(urls.thumbSrc).toBe(urls.src);
  });

  it("never signs a video's original, which plays through the content route", async () => {
    const urls = await signMediaUrls({
      kind: "video",
      mimeType: "video/quicktime",
      blobPathname: "events/e/v.mov",
      posterPathname: "events/e/v-poster.jpg",
      thumbPathname: null,
    });
    expect(urls.src).toBeNull();
    expect(urls.posterSrc).toContain("v-poster.jpg");
    expect(urls.thumbSrc).toBe(urls.posterSrc);
    expect(JSON.stringify(urls)).not.toContain("v.mov");
  });

  it("asks only for private caching, so no shared cache keeps the bytes", async () => {
    const urls = await signMediaUrls(photo);
    const params = new URL(urls.src!).searchParams;
    expect(params.get("response-cache-control")).toMatch(/^private, max-age=\d+$/);
  });
});
