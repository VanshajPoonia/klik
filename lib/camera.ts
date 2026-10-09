import { COMPRESS_MAX_DIMENSION, COMPRESS_QUALITY } from "./media-constants";
import { applyAdjustments, autoEnhance, type Look } from "./image-enhance";

/**
 * Browser camera helpers. The DOM lib types don't yet describe the newer
 * MediaStreamTrack capabilities (torch, zoom, focus), so we model the slices we
 * touch here and cast at the call sites rather than augmenting the global lib.
 */

export type FacingMode = "user" | "environment";
export type FlashMode = "off" | "on" | "auto";
export type CaptureMode = "photo" | "video";

interface RangeCapability {
  min: number;
  max: number;
  step?: number;
}

interface ExtendedCapabilities {
  zoom?: RangeCapability;
  torch?: boolean;
  focusMode?: string[];
}

interface ExtendedConstraintSet {
  zoom?: number;
  torch?: boolean;
  focusMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
}

export interface CameraCapabilities {
  hasTorch: boolean;
  zoom: RangeCapability | null;
  canFocus: boolean;
}

/** Whether the browser can open a camera at all. */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Opens a camera stream for the given facing mode at the highest practical
 * resolution the device will grant. */
export async function openStream(facingMode: FacingMode): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    },
  });
}

/** Opens a stream with audio too, for video recording. */
export async function openStreamWithAudio(facingMode: FacingMode): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
}

export function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  const caps = (
    typeof track.getCapabilities === "function" ? track.getCapabilities() : {}
  ) as ExtendedCapabilities;
  return {
    hasTorch: caps.torch === true,
    zoom: caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null,
    canFocus: Array.isArray(caps.focusMode) && caps.focusMode.includes("manual"),
  };
}

/** The `advanced` constraint entries below use capabilities newer than the DOM
 * lib types, so each is cast through `unknown` to `MediaTrackConstraintSet`. */
function advanced(set: ExtendedConstraintSet): MediaTrackConstraintSet {
  return set as unknown as MediaTrackConstraintSet;
}

export async function applyTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  try {
    await track.applyConstraints({ advanced: [advanced({ torch: on })] });
  } catch {
    // Device declined the torch constraint; caller keeps its own state honest.
  }
}

export async function applyZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [advanced({ zoom })] });
    return true;
  } catch {
    return false;
  }
}

/** Nudges continuous autofocus toward a normalized point (0..1) in the frame,
 * where the device supports it. */
export async function focusAt(track: MediaStreamTrack, x: number, y: number): Promise<void> {
  try {
    await track.applyConstraints({
      advanced: [advanced({ focusMode: "single-shot", pointsOfInterest: [{ x, y }] })],
    });
  } catch {
    // Point-of-interest focus is best-effort; ignore unsupported devices.
  }
}

/** Cheaply estimates average luminance (0..1) of the current frame so the auto
 * flash can decide whether the scene is dark enough to warrant a flash. */
export function estimateBrightness(video: HTMLVideoElement): number {
  const w = 32;
  const h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 1;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (w * h) / 255;
}

/**
 * Draws the current video frame to a JPEG blob. Mirrors the output when the
 * preview was mirrored (front camera) so the saved shot matches what the user
 * framed, and applies any digital zoom the hardware couldn't do itself by
 * cropping toward the center.
 */
export interface CapturedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export async function capturePhoto(
  video: HTMLVideoElement,
  { mirror, digitalZoom, look }: { mirror: boolean; digitalZoom: number; look?: Look },
): Promise<CapturedPhoto | null> {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (!sourceW || !sourceH) return null;

  // Crop toward the center for any zoom the track itself didn't apply.
  const cropW = sourceW / digitalZoom;
  const cropH = sourceH / digitalZoom;
  const cropX = (sourceW - cropW) / 2;
  const cropY = (sourceH - cropH) / 2;

  const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(cropW, cropH));
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (mirror) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  // Bake the look in as pixel math rather than ctx.filter, so the saved photo
  // looks the same on every browser. Auto gets the histogram pass; the rest are
  // straight adjustments.
  if (look?.enhance) autoEnhance(ctx, outW, outH);
  else if (look) applyAdjustments(ctx, outW, outH, look.adjust);

  // Encode straight to the upload pipeline's final quality. The capture is
  // already within COMPRESS_MAX_DIMENSION, so the uploader can skip its own
  // decode/re-encode pass entirely instead of doing the work twice.
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY / 100),
  );
  return blob ? { blob, width: outW, height: outH } : null;
}

export interface FilteredStream {
  stream: MediaStream;
  stop: () => void;
}

/**
 * Routes the live camera through a canvas so a look (and the selfie mirror)
 * bake into recorded video, then re-attaches the original audio. Used only when
 * a look is actually selected - plain recording stays on the direct stream so
 * it costs nothing in the common case.
 */
export function createFilteredStream(
  video: HTMLVideoElement,
  source: MediaStream,
  { filter, mirror, fps = 30 }: { filter: string; mirror: boolean; fps?: number },
): FilteredStream | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let frame = 0;
  const draw = () => {
    // Mirroring is a transform; the look is a filter. Re-applied each frame
    // because ctx state doesn't survive a drawImage cycle predictably.
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
    ctx.filter = filter && filter !== "none" ? filter : "none";
    ctx.drawImage(video, 0, 0, width, height);
    frame = requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(fps);
  source.getAudioTracks().forEach((track) => stream.addTrack(track));

  return {
    stream,
    stop: () => {
      cancelAnimationFrame(frame);
      stream.getVideoTracks().forEach((track) => track.stop());
    },
  };
}

/** Picks the best video container/codec this browser can actually record. */
export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "bin";
}

/**
 * CAM-1: when a photo was taken, as the zone-less wall clock the upload path
 * carries (`YYYY-MM-DDTHH:MM:SS`, the shape EXIF gives). Photos from the
 * in-app camera have no EXIF, so without this they reached AI-1 with no
 * capture time, and a burst shot in the app could never stack.
 */
export function wallClock(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * CAM-1: how far to turn a line on screen so it lies along the real horizon,
 * from a `deviceorientation` reading and the screen's rotation.
 *
 * Worked from gravity rather than from gamma alone, which only means "tilt"
 * while the phone is flat: the world's up vector in device coordinates is
 * (-sin g cos b, sin b, cos g cos b), whatever alpha is. Its part in the
 * screen's plane is turned by the screen's own rotation into the page's axes,
 * and the angle of that from straight up is the line's rotation, clockwise
 * positive, as CSS `rotate()` reads it.
 *
 * `flat` when the phone faces the floor or the sky, where a horizon means
 * nothing and the reading swings wildly.
 */
export function levelAngle(
  beta: number,
  gamma: number,
  screenAngle = 0,
): { degrees: number; flat: boolean } {
  const rad = Math.PI / 180;
  const b = beta * rad;
  const g = gamma * rad;
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const uz = Math.cos(g) * Math.cos(b);
  // The device turned counter-clockwise by `screenAngle`, and the page with it
  // the other way, so the up vector is turned forward by the same amount.
  const a = screenAngle * rad;
  const x = ux * Math.cos(a) - uy * Math.sin(a);
  const y = ux * Math.sin(a) + uy * Math.cos(a);
  const degrees = Math.atan2(x, y) / rad;
  return { degrees: Object.is(degrees, -0) ? 0 : degrees, flat: Math.abs(uz) > 0.85 };
}

/** Within this of level, the line turns to the accent colour. */
export const LEVEL_TOLERANCE_DEGREES = 1;

export interface CameraFailure {
  message: string;
  /** How to fix it on this kind of device, when there is a way. */
  help: string | null;
}

/**
 * CAM-1: what to tell someone whose camera did not open, and how they get it
 * back on the device they are holding. Every case also gets the phone's own
 * camera and the photo library as a way round, so nobody is stuck.
 */
export function cameraFailure(error: unknown, userAgent: string): CameraFailure {
  const name = (error as { name?: string } | null)?.name ?? "";
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
  const android = /Android/i.test(userAgent);
  // Instagram, Facebook, TikTok, Snapchat and LINE open links in a browser of
  // their own, and most of those never ask for the camera.
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|Snapchat|Line\//i.test(userAgent);

  if (name === "unsupported") {
    return inApp
      ? {
          message: "This app's built-in browser can't open the camera.",
          help: "Open the page in Safari or Chrome from the menu, or use your phone's camera below.",
        }
      : { message: "This browser can't open the camera here.", help: null };
  }
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    if (inApp) {
      return {
        message: "This app's built-in browser blocked the camera.",
        help: "Open the page in Safari or Chrome from the menu, or use your phone's camera below.",
      };
    }
    return {
      message: "Camera access is blocked for this page.",
      help: ios
        ? "In Safari, tap aA in the address bar, then Website Settings, and set Camera to Allow. Then tap Try again."
        : android
          ? "Tap the icon at the left of the address bar, then Permissions, and allow Camera. Then tap Try again."
          : "Click the camera icon in the address bar and allow it, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return { message: "No camera was found on this device.", help: null };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      message: "Another app is using the camera.",
      help: "Close the other app or video call, then tap Try again.",
    };
  }
  return { message: "The camera didn't start.", help: "Tap Try again, or use your phone's camera below." };
}
