/**
 * QR-3: the printable sign and the story image, drawn in the browser.
 *
 * In the browser rather than on the server because of fonts. The server draws
 * SVG with sharp, whose text rendering depends on fonts installed on the
 * machine, and a Vercel function has none worth relying on; a sign whose event
 * name comes out as boxes is worse than no sign. The browser already has
 * Fraunces and Geist loaded for the page, so the sign uses exactly the type the
 * organizer sees everywhere else. The QR code itself still comes from the
 * server, which is where it is decoded and checked before it is served.
 */

type Template = "classic" | "minimal" | "bold";

function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(variable).trim();
  return value || fallback;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The QR code could not be loaded"));
    image.src = url;
  });
}

/** Splits `text` into at most `maxLines` lines that fit `width`, shrinking the
 *  font until they do. Returns the size used and the lines. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  { family, weight, start, min, width, maxLines }: { family: string; weight: number; start: number; min: number; width: number; maxLines: number },
): { size: number; lines: string[] } {
  for (let size = start; size >= min; size -= 4) {
    context.font = `${weight} ${size}px ${family}`;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((entry) => context.measureText(entry).width <= width)) {
      return { size, lines };
    }
  }
  context.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: [text] };
}

/** By hand rather than `roundRect`, which Safari before 16 lacks and throws on. */
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
  context.fill();
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not draw the image"))), "image/png"),
  );
}

interface ComposeInput {
  qrUrl: string;
  eventName: string;
  guestUrl: string;
  accent: string;
}

/** 6 x 8 inches at 300 dpi, in the event's chosen template. */
export async function composeSign({ qrUrl, eventName, guestUrl, accent, template }: ComposeInput & { template: Template }): Promise<Blob> {
  await document.fonts.ready;
  const display = cssFont("--font-fraunces", "Georgia, serif");
  const sans = cssFont("--font-geist-sans", "system-ui, sans-serif");
  const qr = await loadImage(qrUrl);

  const width = 1800;
  const height = 2400;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;

  const background = template === "bold" ? accent : template === "minimal" ? "#ffffff" : "#090a08";
  const foreground = template === "classic" ? "#ffffff" : "#090a08";
  const rule = template === "bold" ? "#090a08" : accent;

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = rule;
  roundedRect(context, 110, 110, 1580, 18, 9);

  context.fillStyle = foreground;
  context.textAlign = "center";
  context.font = `700 54px ${sans}`;
  context.letterSpacing = "10px";
  context.fillText("KLIK", width / 2, 370);
  context.letterSpacing = "0px";

  const title = fitText(context, eventName, { family: display, weight: 700, start: 120, min: 64, width: 1500, maxLines: 2 });
  context.font = `700 ${title.size}px ${display}`;
  title.lines.forEach((line, index) => context.fillText(line, width / 2, 560 + index * title.size * 1.1));

  context.globalAlpha = 0.72;
  context.font = `400 48px ${sans}`;
  context.fillText("Scan to share photos and videos", width / 2, 790);
  context.globalAlpha = 1;

  context.fillStyle = "#ffffff";
  roundedRect(context, 300, 880, 1200, 1200, template === "minimal" ? 24 : 90);
  context.drawImage(qr, 400, 980, 1000, 1000);

  context.fillStyle = foreground;
  context.globalAlpha = 0.72;
  context.font = `400 34px ${sans}`;
  context.fillText(guestUrl.replace(/^https?:\/\//, ""), width / 2, 2225);
  context.globalAlpha = 1;
  context.fillStyle = rule;
  context.beginPath();
  context.arc(width / 2, 2305, 13, 0, Math.PI * 2);
  context.fill();

  return toBlob(canvas);
}

/** 1080 x 1920, for an Instagram or WhatsApp story. */
export async function composeStory({ qrUrl, eventName, guestUrl, accent }: ComposeInput): Promise<Blob> {
  await document.fonts.ready;
  const display = cssFont("--font-fraunces", "Georgia, serif");
  const sans = cssFont("--font-geist-sans", "system-ui, sans-serif");
  const qr = await loadImage(qrUrl);

  const width = 1080;
  const height = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;

  context.fillStyle = "#050505";
  context.fillRect(0, 0, width, height);
  context.fillStyle = accent;
  roundedRect(context, 90, 120, 900, 12, 6);

  context.fillStyle = "#f3f1e9";
  context.textAlign = "center";
  const title = fitText(context, eventName, { family: display, weight: 700, start: 104, min: 56, width: 900, maxLines: 3 });
  context.font = `700 ${title.size}px ${display}`;
  title.lines.forEach((line, index) => context.fillText(line, width / 2, 360 + index * title.size * 1.1));

  context.font = `500 44px ${sans}`;
  context.fillStyle = accent;
  context.fillText("Add your photos", width / 2, 640);

  context.fillStyle = "#ffffff";
  roundedRect(context, 190, 720, 700, 700, 56);
  context.drawImage(qr, 240, 770, 600, 600);

  context.fillStyle = "#f3f1e9";
  context.globalAlpha = 0.7;
  context.font = `400 32px ${sans}`;
  context.fillText("Scan, or open", width / 2, 1540);
  context.globalAlpha = 1;
  context.font = `500 36px ${sans}`;
  context.fillText(guestUrl.replace(/^https?:\/\//, ""), width / 2, 1600);

  context.globalAlpha = 0.6;
  context.font = `600 30px ${sans}`;
  context.fillText("klik", width / 2, 1800);
  context.globalAlpha = 1;
  return toBlob(canvas);
}

/** Shares a file through the phone's own share sheet when it can, which is how
 *  a QR code actually reaches a WhatsApp group; downloads it otherwise. */
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return "downloaded";
}
