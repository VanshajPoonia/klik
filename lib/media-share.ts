/**
 * CAM-3: sharing one photo or video out of the gallery, done on the viewer's
 * own phone.
 *
 * Nothing here stores anything. The file a guest sends is the one they are
 * looking at, the smaller copy and the story image are drawn on a canvas, and
 * a link to a photo is a link into the gallery, so whoever opens it passes the
 * same gate as everyone else. The story carries the gallery's QR code in its
 * corner: a guest posting a photo also posts the way in, which is the point.
 */

import { cssFont, fitText, roundedPath, roundedRect } from "./qr-compose";

/** The smaller copy's long edge: sharp on a phone, a fraction of the bytes. */
export const SMALLER_COPY_LONG_EDGE = 1600;
const SMALLER_COPY_QUALITY = 0.85;
const STORY_QUALITY = 0.9;

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/** Where one item opens in its gallery. */
export function photoLink(origin: string, slug: string, mediaId: string): string {
  return `${origin}/e/${encodeURIComponent(slug)}?m=${encodeURIComponent(mediaId)}`;
}

/** The `?m=` a gallery was opened with, when it is shaped like a media id. */
export function linkedMediaId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** `slug-1a2b3c4d.jpg`, matching what the download route names the same file. */
export function shareFilename(slug: string, mediaId: string, mimeType: string, suffix = ""): string {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONS[type] ?? (type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin");
  return `${slug}-${mediaId.slice(0, 8)}${suffix}.${extension}`;
}

/** Whether this browser's share sheet takes files, before there is one. */
export function canShareFiles(files?: File[]): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: files ?? [new File([new Uint8Array(1)], "probe.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

async function readWithProgress(response: Response, onProgress?: (fraction: number) => void): Promise<Blob> {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!onProgress || !total || !response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(1, received / total));
  }
  const type = response.headers.get("content-type") ?? "application/octet-stream";
  return new Blob(chunks as BlobPart[], { type });
}

/**
 * The bytes of one item. The signed URL first, which goes straight to R2, and
 * the authorized route when that has expired. Neither sends cookies across
 * origins: the signature, or the route that hands one out, is the credential.
 */
export async function fetchMediaBlob(
  urls: { src?: string | null; blobUrl: string },
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Blob> {
  if (urls.src) {
    try {
      const response = await fetch(urls.src, { signal, mode: "cors", credentials: "omit" });
      if (response.ok) return await readWithProgress(response, onProgress);
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
    }
  }
  const response = await fetch(urls.blobUrl, { signal, credentials: "same-origin" });
  // TRS-3: a code beside the English, so the share sheet can say it in the guest's language.
  if (response.status === 409) {
    throw Object.assign(new Error("This video is still being prepared. Try again in a minute."), { code: "video_preparing" });
  }
  if (!response.ok) throw Object.assign(new Error("It could not be loaded. Try again."), { code: "load_failed" });
  return readWithProgress(response, onProgress);
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not draw the image"))), "image/jpeg", quality),
  );
}

/** The size a photo is drawn at for the smaller copy. Never enlarges. */
export function smallerCopySize(width: number, height: number, longEdge = SMALLER_COPY_LONG_EDGE) {
  const scale = Math.min(1, longEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A photo at most 1600px on its long edge, for a message rather than a print. */
export async function smallerCopy(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  try {
    const size = smallerCopySize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await toJpeg(canvas, SMALLER_COPY_QUALITY);
  } finally {
    bitmap.close();
  }
}

/** Where a picture goes when it is fitted inside a box, centred, never cropped. */
export function containIn(
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box.w / width, box.h / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}

/** The part of a picture that covers a box of the given shape, centred. */
export function coverCrop(width: number, height: number, aspect: number) {
  if (width / height > aspect) {
    const w = height * aspect;
    return { sx: (width - w) / 2, sy: 0, sw: w, sh: height };
  }
  const h = width / aspect;
  return { sx: 0, sy: (height - h) / 2, sw: width, sh: h };
}

/** A color token as hex, which is all the QR library takes. */
function cssColor(variable: string, fallback: string): string {
  const value = cssFont(variable, fallback);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * 1080 x 1920 for an Instagram or WhatsApp story: the photo whole, over a
 * blurred and darkened copy of itself, with the event's name and the gallery's
 * QR code along the bottom. The code is drawn here from the gallery's address,
 * so it needs no request and says exactly what the guest's own QR sign says.
 */
export async function composeMediaStory({
  photo,
  eventName,
  galleryUrl,
  accent,
}: {
  photo: Blob;
  eventName: string;
  galleryUrl: string;
  accent: string;
}): Promise<Blob> {
  const [{ default: QRCode }, bitmap] = await Promise.all([import("qrcode"), createImageBitmap(photo), document.fonts.ready]);
  try {
    const display = cssFont("--font-fraunces", "Georgia, serif");
    const sans = cssFont("--font-geist-sans", "system-ui, sans-serif");
    const ink = cssColor("--color-canvas", "#050505");
    const paper = cssColor("--color-paper", "#f3f1e9");

    const canvas = document.createElement("canvas");
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const context = canvas.getContext("2d")!;

    // The backdrop: the photo shrunk to a few dozen pixels and stretched back
    // up, which blurs it on every browser. Safari has no canvas `filter`.
    const crop = coverCrop(bitmap.width, bitmap.height, STORY_WIDTH / STORY_HEIGHT);
    const tiny = document.createElement("canvas");
    tiny.width = 27;
    tiny.height = 48;
    tiny.getContext("2d")!.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 27, 48);
    const middle = document.createElement("canvas");
    middle.width = 108;
    middle.height = 192;
    const middleContext = middle.getContext("2d")!;
    middleContext.imageSmoothingQuality = "high";
    middleContext.drawImage(tiny, 0, 0, 108, 192);
    context.imageSmoothingQuality = "high";
    context.drawImage(middle, 0, 0, STORY_WIDTH, STORY_HEIGHT);
    context.fillStyle = ink;
    context.globalAlpha = 0.6;
    context.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
    context.globalAlpha = 1;

    // The photo itself, whole, in a rounded frame.
    const margin = 64;
    const band = 296;
    const placed = containIn(bitmap.width, bitmap.height, {
      x: margin,
      y: 96,
      w: STORY_WIDTH - margin * 2,
      h: STORY_HEIGHT - 96 - margin - band - 40,
    });
    context.save();
    roundedPath(context, placed.x, placed.y, placed.w, placed.h, 36);
    context.clip();
    context.drawImage(bitmap, placed.x, placed.y, placed.w, placed.h);
    context.restore();

    // The QR code in the bottom right corner, on white so any phone reads it.
    const cardX = STORY_WIDTH - margin - band;
    const cardY = STORY_HEIGHT - margin - band;
    context.fillStyle = "#ffffff";
    roundedRect(context, cardX, cardY, band, band, 28);
    const qr = document.createElement("canvas");
    await QRCode.toCanvas(qr, galleryUrl, {
      margin: 0,
      width: band - 48,
      errorCorrectionLevel: "M",
      color: { dark: ink, light: "#ffffff" },
    });
    context.drawImage(qr, cardX + 24, cardY + 24, band - 48, band - 48);

    // Beside it, from the bottom up: the address, the invitation, the name.
    const textWidth = cardX - margin - 40;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    let baseline = STORY_HEIGHT - margin - 6;

    const address = galleryUrl.replace(/^https?:\/\//, "");
    const addressFit = fitText(context, address, { family: sans, weight: 500, start: 28, min: 18, width: textWidth, maxLines: 1 });
    context.font = `500 ${addressFit.size}px ${sans}`;
    context.fillStyle = paper;
    context.globalAlpha = 0.7;
    context.fillText(addressFit.lines[0] ?? address, margin, baseline);
    context.globalAlpha = 1;
    baseline -= addressFit.size + 22;

    const invitation = fitText(context, "Scan for every photo, and add yours", {
      family: sans,
      weight: 500,
      start: 32,
      min: 24,
      width: textWidth,
      maxLines: 2,
    });
    context.font = `500 ${invitation.size}px ${sans}`;
    context.fillStyle = paper;
    for (const line of [...invitation.lines].reverse()) {
      context.fillText(line, margin, baseline);
      baseline -= invitation.size * 1.25;
    }
    baseline -= 18;

    const title = fitText(context, eventName, { family: display, weight: 700, start: 60, min: 36, width: textWidth, maxLines: 2 });
    context.font = `700 ${title.size}px ${display}`;
    for (const line of [...title.lines].reverse()) {
      context.fillText(line, margin, baseline);
      baseline -= title.size * 1.08;
    }

    context.fillStyle = accent;
    roundedRect(context, margin, baseline - 14, 64, 10, 5);

    return await toJpeg(canvas, STORY_QUALITY);
  } finally {
    bitmap.close();
  }
}
