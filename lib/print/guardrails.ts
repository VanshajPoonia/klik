import { contrastRatio, relativeLuminance } from "../color";
import { QR_QUIET_MODULES } from "../qr-shapes";
import { boxContains, boxesOverlap, elementBox, type Box, type PrintDoc, type PrintElement, type QrElement } from "./doc";
import { MM_PER_POINT } from "./fonts";
import { SAFE_MARGIN_MM, type DesignSize } from "./presets";

/**
 * QR-4f: what is checked before a design is exported. The four checks the
 * roadmap names are what separate a print tool from a toy: a code too small
 * to scan across a room, a code without the contrast a camera needs, something
 * the guillotine will cut through, and a photo that will print soft. Each one
 * is a warning the host can export past, said in words a person who has never
 * sent anything to a printer understands.
 *
 * Pure, so every template is held to it in a test. The export dialog adds one
 * more check this cannot make: it renders the page and reads every code back
 * with a QR decoder, which catches what arithmetic cannot (a photo behind a
 * transparent code, a sticker over its corner).
 */

/** Smaller than this across, a code is unreliable at arm's length and beyond. */
export const MIN_QR_MM = 25;
/** A story is seen on a screen: the code should be a fifth of its width. */
export const MIN_DIGITAL_QR_SHARE = 0.2;
export const MIN_QR_CONTRAST = 4.5;
/** Below this a photo prints visibly soft; 300 is what printers ask for. */
export const MIN_IMAGE_DPI = 150;
export const GOOD_IMAGE_DPI = 300;
/** Text smaller than this is hard to read on paper. */
export const MIN_TEXT_POINTS = 6;

export type FindingLevel = "warning" | "notice";

export interface Finding {
  key: string;
  level: FindingLevel;
  title: string;
  detail: string;
  elementId?: string;
}

export interface GuardrailInput {
  doc: PrintDoc;
  size: DesignSize & { digital: boolean };
  /** Modules across this event's code, from its address. */
  qrModules: number;
  /** Pixel sizes of the images the design draws, by asset id. */
  assets: ReadonlyMap<string, { width: number; height: number }>;
}

const describe = (element: PrintElement): string =>
  element.name ??
  (element.type === "qr"
    ? "The QR code"
    : element.type === "text"
      ? `"${element.text.trim().slice(0, 24) || "Text"}${element.text.trim().length > 24 ? "…" : ""}"`
      : element.type === "image"
        ? "A photo"
        : "A shape");

/** The width of the code itself, without its quiet zone. */
export function qrCodeMm(element: Pick<QrElement, "width">, modules: number): number {
  return (element.width * modules) / (modules + QR_QUIET_MODULES * 2);
}

/**
 * The colour directly behind a code that draws no square of its own: the top
 * solid shape under it that covers it entirely, or the page. Null when a photo
 * is behind it, which only reading the rendered page can judge.
 */
function colorBehind(doc: PrintDoc, index: number, box: Box): string | null {
  for (let below = index - 1; below >= 0; below -= 1) {
    const element = doc.elements[below];
    if (element.hidden) continue;
    const under = elementBox(element);
    if (!boxesOverlap(under, box)) continue;
    if (element.type === "image") return null;
    if ((element.type === "rect" || element.type === "ellipse") && element.fill && element.opacity >= 0.99) {
      // An ellipse covers its box's corners only partly, so the box it is
      // trusted with is the square inside it.
      const cover =
        element.type === "ellipse"
          ? {
              left: under.left + (under.right - under.left) * 0.15,
              right: under.right - (under.right - under.left) * 0.15,
              top: under.top + (under.bottom - under.top) * 0.15,
              bottom: under.bottom - (under.bottom - under.top) * 0.15,
            }
          : under;
      if (element.rotation % 90 === 0 && boxContains(cover, box)) return element.fill;
    }
  }
  return doc.background.assetId ? null : doc.background.color;
}

/** The page's trim, and its bleed edge, in page millimetres. */
function pageBoxes(size: DesignSize) {
  const trim: Box = { left: 0, top: 0, right: size.widthMm, bottom: size.heightMm };
  const bleed: Box = {
    left: -size.bleedMm,
    top: -size.bleedMm,
    right: size.widthMm + size.bleedMm,
    bottom: size.heightMm + size.bleedMm,
  };
  const safe: Box = {
    left: SAFE_MARGIN_MM,
    top: SAFE_MARGIN_MM,
    right: size.widthMm - SAFE_MARGIN_MM,
    bottom: size.heightMm - SAFE_MARGIN_MM,
  };
  return { trim, bleed, safe };
}

/** Which sides of the trim a box crosses. */
function crossedSides(box: Box, trim: Box): Array<"left" | "top" | "right" | "bottom"> {
  const sides: Array<"left" | "top" | "right" | "bottom"> = [];
  if (box.left < trim.left && box.right > trim.left) sides.push("left");
  if (box.top < trim.top && box.bottom > trim.top) sides.push("top");
  if (box.right > trim.right && box.left < trim.right) sides.push("right");
  if (box.bottom > trim.bottom && box.top < trim.bottom) sides.push("bottom");
  return sides;
}

/** Pixels per inch an image is printed at, for how it fills its frame. */
export function imageDpi(
  frame: { widthMm: number; heightMm: number },
  pixels: { width: number; height: number },
  fit: "cover" | "contain",
): number {
  const scale =
    fit === "cover"
      ? Math.max(frame.widthMm / pixels.width, frame.heightMm / pixels.height)
      : Math.min(frame.widthMm / pixels.width, frame.heightMm / pixels.height);
  return 25.4 / scale;
}

/**
 * Screen colours a printer's inks cannot reach: bright, saturated, and away
 * from the yellows and reds that process inks print well. A rule of thumb, not
 * a colour-managed proof, and said as one.
 */
export function printsDuller(hexColor: string): boolean {
  const value = Number.parseInt(hexColor.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.75 || max < 0.75) return false;
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  const degrees = (hue * 60 + 360) % 360;
  // Reds through yellows print close to the screen; greens, blues and purples
  // at full brightness do not.
  return degrees > 75 && degrees < 340;
}

function colorsOf(doc: PrintDoc): string[] {
  const colors = new Set<string>([doc.background.color.toLowerCase()]);
  for (const element of doc.elements) {
    if (element.hidden) continue;
    if (element.type === "qr") colors.add(element.foreground.toLowerCase());
    if (element.type === "text") colors.add(element.color.toLowerCase());
    if (element.type === "icon") colors.add(element.color.toLowerCase());
    if (element.type === "line") colors.add(element.stroke.toLowerCase());
    if ((element.type === "rect" || element.type === "ellipse") && element.fill) colors.add(element.fill.toLowerCase());
  }
  return [...colors];
}

export function checkDesign({ doc, size, qrModules, assets }: GuardrailInput): Finding[] {
  const findings: Finding[] = [];
  const { trim, bleed, safe } = pageBoxes(size);
  const visible = doc.elements.map((element, index) => ({ element, index })).filter(({ element }) => !element.hidden);
  const codes = visible.filter(({ element }) => element.type === "qr") as Array<{ element: QrElement; index: number }>;

  if (codes.length === 0) {
    findings.push({
      key: "qr-missing",
      level: "notice",
      title: "There is no QR code on this design",
      detail: "Guests reach the gallery by scanning it. Add one from the toolbar if this is meant to bring people in.",
    });
  }

  for (const { element, index } of codes) {
    const name = describe(element);
    const codeMm = qrCodeMm(element, qrModules);

    // 1. Big enough to scan.
    if (size.digital) {
      const share = element.width / Math.min(size.widthMm, size.heightMm);
      if (share < MIN_DIGITAL_QR_SHARE) {
        findings.push({
          key: `qr-small-${element.id}`,
          level: "warning",
          elementId: element.id,
          title: `${name} is small for a screen`,
          detail: "Someone scanning it from another phone's screen needs it at least a fifth of the way across.",
        });
      }
    } else if (codeMm < MIN_QR_MM - 0.05) {
      findings.push({
        key: `qr-small-${element.id}`,
        level: "warning",
        elementId: element.id,
        title: `${name} is too small to scan reliably`,
        detail: `It prints ${(codeMm / 10).toFixed(1)} cm across. Make it at least 2.5 cm, and bigger for a sign people read from a distance.`,
      });
    }

    // 2. Contrast a camera can read, dark on light.
    const box = elementBox(element);
    const behind = element.background ?? colorBehind(doc, index, box);
    if (behind === null) {
      findings.push({
        key: `qr-photo-${element.id}`,
        level: "notice",
        elementId: element.id,
        title: `${name} sits on a photo`,
        detail: "Give it its own background colour, or it scans only where the photo is plain. The export checks it either way.",
      });
    } else {
      const ratio = contrastRatio(element.foreground, behind);
      if (ratio < MIN_QR_CONTRAST) {
        findings.push({
          key: `qr-contrast-${element.id}`,
          level: "warning",
          elementId: element.id,
          title: `${name} does not stand out enough to scan`,
          detail: `Its colours have a contrast of ${ratio.toFixed(1)} to 1. Phone cameras need at least 4.5 to 1; dark on white is safest.`,
        });
      } else if (relativeLuminance(element.foreground) > relativeLuminance(behind)) {
        findings.push({
          key: `qr-inverted-${element.id}`,
          level: "warning",
          elementId: element.id,
          title: `${name} is light on dark`,
          detail: "Many phone cameras cannot read a code drawn the other way round. Use a dark code on a light background.",
        });
      }
    }

    // Anything drawn over the code hides modules from the camera.
    const covering = visible.find(({ element: other, index: at }) => at > index && boxesOverlap(elementBox(other), box));
    if (covering) {
      findings.push({
        key: `qr-covered-${element.id}`,
        level: "warning",
        elementId: element.id,
        title: `Something is on top of ${element.name ? `"${element.name}"` : "the QR code"}`,
        detail: `${describe(covering.element)} overlaps it. Move it off, or send it behind the code.`,
      });
    }
  }

  // 3. The cut. Size-only checks for a digital design, which is never cut.
  if (!size.digital) {
    for (const { element } of visible) {
      const box = elementBox(element);
      const name = describe(element);
      const content = element.type === "text" || element.type === "qr" || element.type === "icon";
      const sides = crossedSides(box, trim);
      if (content) {
        if (sides.length > 0) {
          findings.push({
            key: `cut-${element.id}`,
            level: "warning",
            elementId: element.id,
            title: `${name} crosses the edge and will be cut`,
            detail: "Move it inside the dashed safe line.",
          });
        } else if (boxesOverlap(box, trim) && !boxContains(safe, box)) {
          findings.push({
            key: `edge-${element.id}`,
            level: "notice",
            elementId: element.id,
            title: `${name} is very close to the edge`,
            detail: "Printers cut to within about 3 mm. Keep words and codes inside the dashed safe line.",
          });
        }
      } else if (sides.length > 0 && size.bleedMm > 0) {
        // A shape or photo meant to run off the page has to reach the bleed
        // edge, or the cut leaves a hairline of white along that side.
        const short = sides.filter((side) =>
          side === "left"
            ? box.left > bleed.left + 0.01
            : side === "top"
              ? box.top > bleed.top + 0.01
              : side === "right"
                ? box.right < bleed.right - 0.01
                : box.bottom < bleed.bottom - 0.01,
        );
        if (short.length > 0) {
          findings.push({
            key: `bleed-${element.id}`,
            level: "warning",
            elementId: element.id,
            title: `${name} runs off the page but stops short of the bleed`,
            detail: `Stretch it to the outer line on the ${short.join(" and ")}, or the cut can leave a thin white edge.`,
          });
        }
      }

      if (element.type === "text" && element.size < MIN_TEXT_POINTS) {
        findings.push({
          key: `tiny-${element.id}`,
          level: "notice",
          elementId: element.id,
          title: `${name} is very small`,
          detail: `${element.size} pt is hard to read on paper. ${MIN_TEXT_POINTS} pt is about the least that prints clearly.`,
        });
      }
    }
  }

  // 4. Photos sharp enough at the size they are placed.
  if (!size.digital) {
    const frames: Array<{ id?: string; name: string; widthMm: number; heightMm: number; assetId: string; fit: "cover" | "contain" }> = [];
    if (doc.background.assetId) {
      frames.push({
        name: "The background photo",
        widthMm: size.widthMm + size.bleedMm * 2,
        heightMm: size.heightMm + size.bleedMm * 2,
        assetId: doc.background.assetId,
        fit: "cover",
      });
    }
    for (const { element } of visible) {
      if (element.type === "image") {
        frames.push({ id: element.id, name: describe(element), widthMm: element.width, heightMm: element.height, assetId: element.assetId, fit: element.fit });
      }
    }
    for (const frame of frames) {
      const pixels = assets.get(frame.assetId);
      if (!pixels) continue;
      const dpi = imageDpi(frame, pixels, frame.fit);
      if (dpi < MIN_IMAGE_DPI) {
        findings.push({
          key: `dpi-${frame.id ?? "background"}`,
          level: "warning",
          elementId: frame.id,
          title: `${frame.name} will print blurry`,
          detail: `At this size it prints at about ${Math.round(dpi)} pixels per inch. ${MIN_IMAGE_DPI} is the least for print and ${GOOD_IMAGE_DPI} is best: make it smaller, or use a larger photo.`,
        });
      }
    }
  }

  // Colours a printer cannot match.
  if (!size.digital) {
    const dull = colorsOf(doc).filter(printsDuller);
    if (dull.length > 0) {
      findings.push({
        key: "cmyk",
        level: "notice",
        title: `${dull.length === 1 ? "A bright colour" : "Some bright colours"} will print duller than on screen`,
        detail: `${dull.join(", ")}. Printers mix colour from four inks, which cannot reach the brightest greens, blues and purples a screen shows. Ask for a proof if the colour matters.`,
      });
    }
  }

  return findings;
}

/** Text size in millimetres on the page, for the canvas. */
export const pointsToMm = (points: number) => points * MM_PER_POINT;
