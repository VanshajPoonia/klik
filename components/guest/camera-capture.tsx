"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Grid3x3,
  Images,
  RotateCcw,
  SwitchCamera,
  Timer,
  Trash2,
  Video,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { nanoid } from "nanoid";
import { baseMimeType } from "@/lib/media-constants";
import {
  DEFAULT_LOOK,
  LOOKS,
  lookById,
  supportsCtxFilter,
  type LookId,
} from "@/lib/image-enhance";
import {
  applyTorch,
  applyZoom,
  cameraFailure,
  cameraSupported,
  capturePhoto,
  createFilteredStream,
  estimateBrightness,
  extensionForMime,
  focusAt,
  levelAngle,
  LEVEL_TOLERANCE_DEGREES,
  openStream,
  openStreamWithAudio,
  pickRecorderMimeType,
  readCapabilities,
  wallClock,
  type CameraCapabilities,
  type CameraFailure,
  type CaptureMode,
  type FacingMode,
  type FilteredStream,
  type FlashMode,
} from "@/lib/camera";

interface Shot {
  id: string;
  file: File;
  url: string;
  kind: "photo" | "video";
  /** Present for photos: they are already encoded at final size/quality, so the
   * uploader can skip re-compressing them. */
  width?: number;
  height?: number;
  /** CAM-1: the wall clock when it was taken. A capture has no EXIF. */
  capturedAt?: string;
}

/** What the camera hands back for upload. */
export interface CapturedItem {
  file: File;
  width?: number;
  height?: number;
  capturedAt?: string;
}

const TIMER_STEPS = [0, 3, 10] as const;
/** CAM-1: holding the shutter this long starts a burst instead of one shot. */
const BURST_HOLD_MS = 350;
const BURST_MAX = 20;
/** A pause between frames, on top of the time a capture takes. */
const BURST_GAP_MS = 120;
const DARK_THRESHOLD = 0.28;
const DOUBLE_TAP_MS = 300;

// Guests' camera setup (which way they face, flash, grid, look) is remembered
// across visits so reopening the camera feels like their own, not a reset.
const PREFS_KEY = "klik.camera.prefs";
interface CameraPrefs {
  facing: FacingMode;
  flash: FlashMode;
  grid: boolean;
  look: LookId;
}

function loadPrefs(): Partial<CameraPrefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs(prefs: CameraPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private-mode or storage-full: preferences just won't persist.
  }
}

/**
 * CAM-4: the sound a disposable camera makes winding on to the next frame,
 * synthesized rather than shipped as a file: a short ratchet of filtered noise.
 * Silent wherever audio is unavailable or blocked, which is never a reason for
 * the shot itself to fail.
 */
function windOn(): void {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const clicks = 6;
    for (let index = 0; index < clicks; index += 1) {
      const start = context.currentTime + 0.12 + index * 0.045;
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.02), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let sample = 0; sample < data.length; sample += 1) {
        data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2200;
      const gain = context.createGain();
      gain.gain.value = 0.25;
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(start);
    }
    setTimeout(() => void context.close().catch(() => {}), 800);
  } catch {
    // No sound is fine.
  }
}

export function CameraCapture({
  onComplete,
  onClose,
  allowVideo: allowVideoProp = true,
  disposable,
}: {
  onComplete: (items: CapturedItem[]) => void;
  onClose: () => void;
  allowVideo?: boolean;
  /**
   * CAM-4: a disposable roll. Photos only, a counter instead of a review tray,
   * no looking back at shots taken, and the shutter stops at the last frame.
   * The point is composing each shot, so the camera behaves like one.
   */
  disposable?: { shotsLeft: number };
}) {
  const allowVideo = allowVideoProp && !disposable;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const filteredRef = useRef<FilteredStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pinchRef = useRef<number | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastTapRef = useRef(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstingRef = useRef(false);
  // Where a press on the shutter is: none, held but not yet a burst, a burst.
  const pressRef = useRef<"none" | "pressed" | "burst">("none");
  const libraryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  const [facing, setFacing] = useState<FacingMode>(() => loadPrefs().facing ?? "environment");
  const [mode, setMode] = useState<CaptureMode>("photo");
  const [caps, setCaps] = useState<CameraCapabilities>({
    hasTorch: false,
    zoom: null,
    canFocus: false,
  });
  const [flash, setFlash] = useState<FlashMode>(() => loadPrefs().flash ?? "off");
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState<boolean>(() => loadPrefs().grid ?? false);
  const [look, setLook] = useState<LookId>(() => loadPrefs().look ?? DEFAULT_LOOK);
  const [timer, setTimer] = useState<(typeof TIMER_STEPS)[number]>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [preview, setPreview] = useState<Shot | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [flashScreen, setFlashScreen] = useState(false);
  const [captureBlink, setCaptureBlink] = useState(false);
  const [lookToast, setLookToast] = useState<string | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<CameraFailure | null>(null);
  const [burstCount, setBurstCount] = useState<number | null>(null);
  const [level, setLevel] = useState<{ degrees: number; flat: boolean } | null>(null);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState(false);

  const mirror = facing === "user";
  // Zoom the hardware couldn't do natively is applied as a CSS/crop fallback.
  const zoomIsNative = Boolean(caps.zoom);
  const digitalZoom = zoomIsNative ? 1 : zoom;
  const activeLook = lookById(look);
  // Video looks ride on canvas ctx.filter; without it, video records raw and we
  // keep the preview honest by not showing a look we can't deliver.
  const looksApplyHere = mode === "photo" || supportsCtxFilter();

  // Zoom presets, expressed as multiples of each camera's own "no zoom" base.
  const zoomBase = caps.zoom?.min ?? 1;
  const zoomMax = caps.zoom?.max ?? 5;
  const zoomPresets = [1, 2, 3].filter((f) => zoomBase * f <= zoomMax + 1e-6);
  const nearestPreset = zoomPresets.reduce(
    (best, f) => (Math.abs(zoomBase * f - zoom) < Math.abs(zoomBase * best - zoom) ? f : best),
    zoomPresets[0] ?? 1,
  );

  const trackTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!cameraSupported()) {
      setError(cameraFailure({ name: "unsupported" }, navigator.userAgent));
      setStarting(false);
      return;
    }
    setStarting(true);
    setError(null);
    stopStream();
    try {
      const stream =
        mode === "video" ? await openStreamWithAudio(facing) : await openStream(facing);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const capabilities = readCapabilities(track);
      setCaps(capabilities);
      // Reset to each camera's own "no zoom" baseline, since not every device uses 1.
      setZoom(capabilities.zoom ? capabilities.zoom.min : 1);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setError(cameraFailure(err, navigator.userAgent));
    } finally {
      setStarting(false);
    }
  }, [facing, mode, stopStream]);

  // (Re)open the camera whenever the facing direction or capture mode changes.
  // Opening a live camera stream is exactly the external-system sync effects are
  // for; the loading-state write it makes on entry is intentional.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return () => {
      stopStream();
    };
  }, [start, stopStream]);

  // Release object URLs and any pending timers on unmount.
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach(clearTimeout);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      filteredRef.current?.stop();
      filteredRef.current = null;
    };
  }, []);

  // Remember the guest's setup for next time.
  useEffect(() => {
    savePrefs({ facing, flash, grid, look });
  }, [facing, flash, grid, look]);

  const cleanupAndClose = useCallback(() => {
    stopStream();
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    onClose();
  }, [onClose, shots, stopStream]);

  const changeZoom = useCallback(
    (value: number) => {
      const track = trackRef.current;
      const range = caps.zoom;
      const next = range ? Math.min(Math.max(value, range.min), range.max) : Math.min(Math.max(value, 1), 5);
      setZoom(next);
      if (track && range) void applyZoom(track, next);
    },
    [caps.zoom],
  );

  const toggleFlash = useCallback(() => {
    setFlash((f) => (f === "off" ? "auto" : f === "auto" ? "on" : "off"));
  }, []);

  const runFlashPulse = useCallback(
    async (fire: boolean) => {
      if (!fire) return;
      const track = trackRef.current;
      if (facing === "environment" && caps.hasTorch && track) {
        await applyTorch(track, true);
        trackTimeout(() => void applyTorch(track, false), 400);
      } else {
        // No torch (front camera, or unsupported): blast the screen white.
        setFlashScreen(true);
        trackTimeout(() => setFlashScreen(false), 320);
      }
    },
    [caps.hasTorch, facing, trackTimeout],
  );

  const shootNow = useCallback(async ({ burst = false }: { burst?: boolean } = {}) => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      // No flash inside a burst: a strobe at four frames a second helps nobody.
      const wantFlash =
        !burst && (flash === "on" || (flash === "auto" && estimateBrightness(video) < DARK_THRESHOLD));
      await runFlashPulse(wantFlash);
      if (wantFlash) await new Promise((r) => trackTimeout(() => r(null), 120));

      const capturedAt = wallClock();
      // CAM-1: the front camera's preview is a mirror, which is how people
      // expect to see themselves, but the photo is saved the right way round,
      // as phone cameras do, so writing behind someone reads properly.
      const captured = await capturePhoto(video, { mirror: false, digitalZoom, look: activeLook });
      if (!captured) return;
      // A quick blink of the viewfinder is the tactile "it fired" cue. Not
      // in a burst, where it would strobe; the counter says it is firing.
      if (!burst) {
        setCaptureBlink(true);
        trackTimeout(() => setCaptureBlink(false), 110);
      }
      const id = nanoid();
      const file = new File([captured.blob], `klik-photo-${id}.jpg`, { type: "image/jpeg" });
      const shot: Shot = {
        id,
        file,
        url: URL.createObjectURL(captured.blob),
        kind: "photo",
        width: captured.width,
        height: captured.height,
        capturedAt,
      };
      setShots((prev) => [...prev, shot]);
      if (navigator.vibrate) navigator.vibrate(burst ? 5 : 15);
    } finally {
      setBusy(false);
    }
  }, [activeLook, digitalZoom, flash, runFlashPulse, trackTimeout]);

  const takePhoto = useCallback(() => {
    if (busy || countdown !== null) return;
    if (timer === 0) {
      void shootNow();
      return;
    }
    let remaining = timer;
    setCountdown(remaining);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        setCountdown(null);
        void shootNow();
      } else {
        setCountdown(remaining);
        trackTimeout(tick, 1000);
      }
    };
    trackTimeout(tick, 1000);
  }, [busy, countdown, shootNow, timer, trackTimeout]);

  const startRecording = useCallback(() => {
    const source = streamRef.current;
    if (!source) return;

    // Only pay for the canvas pipeline when a look would actually change the
    // frames; plain recording stays on the direct stream.
    let recordStream = source;
    if (look !== "original" && supportsCtxFilter() && videoRef.current) {
      // Saved the right way round, like a photo (CAM-1).
      const filtered = createFilteredStream(videoRef.current, source, {
        filter: activeLook.preview,
        mirror: false,
      });
      if (filtered) {
        filteredRef.current = filtered;
        recordStream = filtered.stream;
      }
    }

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    } catch {
      filteredRef.current?.stop();
      filteredRef.current = null;
      setError({ message: "This browser can't record video.", help: "Photos still work: close this and switch to Photo." });
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      filteredRef.current?.stop();
      filteredRef.current = null;
      const type = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const id = nanoid();
      // The blob keeps its codec parameters so local playback can use them, but
      // the uploaded file carries the bare type: that string becomes the signed
      // Content-Type on R2 and is matched against the server's MIME allowlist.
      const file = new File([blob], `klik-video-${id}.${extensionForMime(type)}`, {
        type: baseMimeType(type),
      });
      setShots((prev) => [...prev, { id, file, url: URL.createObjectURL(blob), kind: "video" }]);
    };

    if (flash === "on" && caps.hasTorch && trackRef.current) {
      void applyTorch(trackRef.current, true);
    }
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    if (navigator.vibrate) navigator.vibrate(20);
  }, [activeLook.preview, caps.hasTorch, flash, look]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (caps.hasTorch && trackRef.current) void applyTorch(trackRef.current, false);
    if (navigator.vibrate) navigator.vibrate(20);
  }, [caps.hasTorch]);

  const rollSpent = Boolean(disposable) && shots.length >= (disposable?.shotsLeft ?? 0);
  const handleShutter = useCallback(() => {
    if (mode === "photo") {
      if (rollSpent) return;
      takePhoto();
      if (disposable) windOn();
    } else if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [disposable, mode, recording, rollSpent, startRecording, stopRecording, takePhoto]);

  /**
   * CAM-1: burst. Holding the shutter in photo mode shoots frame after frame
   * until it is let go, or twenty frames. Each frame carries its own capture
   * time, so the gallery stacks them as a burst (AI-1). Not on a disposable,
   * where every frame is meant to count, and not with the self-timer on.
   */
  const canBurst = mode === "photo" && !disposable && timer === 0;
  const runBurst = useCallback(async () => {
    burstingRef.current = true;
    let taken = 0;
    setBurstCount(0);
    while (burstingRef.current && taken < BURST_MAX) {
      await shootNow({ burst: true });
      taken += 1;
      setBurstCount(taken);
      await new Promise((resolve) => setTimeout(resolve, BURST_GAP_MS));
    }
    burstingRef.current = false;
    trackTimeout(() => setBurstCount(null), 900);
  }, [shootNow, trackTimeout]);

  const shutterDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pressRef.current = "pressed";
      if (!canBurst || busy || starting || countdown !== null) return;
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        pressRef.current = "burst";
        void runBurst();
      }, BURST_HOLD_MS);
    },
    [busy, canBurst, countdown, runBurst, starting],
  );

  const shutterUp = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = "none";
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    // Letting go ends a burst, including one that already stopped at its
    // limit, and takes nothing more.
    if (press === "burst") {
      burstingRef.current = false;
      return;
    }
    // A tap, or any shutter that cannot burst: the shutter as it always was.
    if (press === "pressed") handleShutter();
  }, [handleShutter]);

  const shutterCancel = useCallback(() => {
    pressRef.current = "none";
    burstingRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // A burst never outlives the camera.
  useEffect(() => () => {
    burstingRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
  }, []);

  /**
   * CAM-1: the grid brings a level with it, a line that lies along the real
   * horizon and turns to the accent when the phone is straight. iOS asks
   * permission for the motion sensor, and only from a tap, so it is asked
   * here, when the grid is switched on.
   */
  const toggleGrid = useCallback(() => {
    const turningOn = !grid;
    setGrid(turningOn);
    if (!turningOn) return;
    const Orientation = (window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> };
    }).DeviceOrientationEvent;
    void Orientation?.requestPermission?.().catch(() => "denied");
  }, [grid]);

  useEffect(() => {
    if (!grid || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    let frame = 0;
    let latest: DeviceOrientationEvent | null = null;
    const screenAngle = () => {
      // window.orientation is the one both iOS and Android agree on: 90 for a
      // phone turned counter-clockwise. screen.orientation is the fallback.
      const legacy = (window as unknown as { orientation?: number }).orientation;
      return typeof legacy === "number" ? legacy : (screen.orientation?.angle ?? 0);
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      latest = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (latest?.beta == null || latest.gamma == null) return;
        const next = levelAngle(latest.beta, latest.gamma, screenAngle());
        // Half a degree is finer than anyone can hold a phone.
        const degrees = Math.round(next.degrees * 2) / 2;
        setLevel((current) =>
          current && current.degrees === degrees && current.flat === next.flat ? current : { degrees, flat: next.flat },
        );
      });
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      if (frame) cancelAnimationFrame(frame);
      setLevel(null);
    };
  }, [grid]);

  /** CAM-1: when the camera cannot open, the phone's own camera or library. */
  const handOverFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      stopStream();
      onComplete(Array.from(files).map((file) => ({ file })));
      onClose();
    },
    [onClose, onComplete, stopStream],
  );

  const switchCamera = useCallback(() => {
    if (recording) return;
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, [recording]);

  const removeShot = useCallback((id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
    setPreview((p) => (p?.id === id ? null : p));
  }, []);

  const finish = useCallback(() => {
    if (shots.length === 0) return;
    stopStream();
    onComplete(shots.map((s) => ({ file: s.file, width: s.width, height: s.height, capturedAt: s.capturedAt })));
    // Revoking only drops the URL mapping; the File objects handed off for
    // upload stay valid.
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    onClose();
  }, [onClose, onComplete, shots, stopStream]);

  const handleTapFocus = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setFocusPoint({ x, y });
      trackTimeout(() => setFocusPoint(null), 900);
      if (track && caps.canFocus) void focusAt(track, mirror ? 1 - x : x, y);
    },
    [caps.canFocus, mirror, trackTimeout],
  );

  const selectLook = useCallback(
    (id: LookId, label: string) => {
      setLook(id);
      setLookToast(label);
      trackTimeout(() => setLookToast(null), 900);
      if (navigator.vibrate) navigator.vibrate(6);
    },
    [trackTimeout],
  );

  const setZoomPreset = useCallback(
    (factor: number) => {
      changeZoom(zoomBase * factor);
      if (navigator.vibrate) navigator.vibrate(6);
    },
    [changeZoom, zoomBase],
  );

  // Single tap focuses; a quick second tap toggles between 1x and 2x, matching
  // the muscle memory guests bring from their phone's own camera.
  const handleViewfinderTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        const doubled = zoomBase * 2;
        const atBase = Math.abs(zoom - zoomBase) < zoomBase * 0.2;
        changeZoom(atBase && doubled <= zoomMax + 1e-6 ? doubled : zoomBase);
        if (navigator.vibrate) navigator.vibrate(8);
        return;
      }
      lastTapRef.current = now;
      handleTapFocus(e);
    },
    [changeZoom, handleTapFocus, zoom, zoomBase, zoomMax],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchRef.current !== null) {
        const delta = (dist - pinchRef.current) / 120;
        changeZoom(zoom + delta);
      }
      pinchRef.current = dist;
    },
    [changeZoom, zoom],
  );

  // Keyboard control, for laptop webcams and anyone not using touch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (preview) setPreview(null);
        else cleanupAndClose();
        return;
      }
      if (preview) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleShutter();
      } else if (e.key.toLowerCase() === "f") {
        switchCamera();
      } else if (e.key.toLowerCase() === "g") {
        toggleGrid();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cleanupAndClose, handleShutter, preview, switchCamera, toggleGrid]);

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black text-paper">
      {/* Viewfinder */}
      <div
        className="relative flex-1 overflow-hidden"
        onClick={handleViewfinderTap}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => {
          pinchRef.current = null;
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
          style={{
            transform: `${mirror ? "scaleX(-1)" : ""} ${
              digitalZoom > 1 ? `scale(${digitalZoom})` : ""
            }`.trim(),
            filter: looksApplyHere ? activeLook.preview : "none",
          }}
        />

        {/* Rule-of-thirds grid */}
        {grid && !error && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
            <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
            <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
            {/* CAM-1: the level. Two fixed stubs mark straight; the line
                between them follows the real horizon. */}
            {level && !level.flat && (
              <div className="absolute left-1/2 top-1/2 flex w-1/2 -translate-x-1/2 -translate-y-1/2 items-center">
                {(() => {
                  const straight = Math.abs(level.degrees) <= LEVEL_TOLERANCE_DEGREES;
                  const tone = straight ? "bg-volt" : "bg-white/70";
                  return (
                    <>
                      <span className={`h-0.5 w-6 rounded-full ${tone}`} />
                      <span
                        className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${tone}`}
                        style={{ transform: `rotate(${straight ? 0 : level.degrees}deg)` }}
                      />
                      <span className={`h-0.5 w-6 rounded-full ${tone}`} />
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Tap-to-focus ring */}
        {focusPoint && (
          <div
            className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-volt"
            style={{
              left: `${focusPoint.x * 100}%`,
              top: `${focusPoint.y * 100}%`,
              animation: "klik-flash-in 0.3s ease-out",
            }}
          />
        )}

        {/* Countdown */}
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="font-display text-8xl text-paper drop-shadow-lg">{countdown}</span>
          </div>
        )}

        {/* Screen flash for front / torch-less capture */}
        {flashScreen && <div className="pointer-events-none absolute inset-0 bg-white" />}

        {/* Shutter blink */}
        {captureBlink && <div className="pointer-events-none absolute inset-0 bg-black/70" />}

        {/* Look name confirmation */}
        {lookToast && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs font-medium backdrop-blur">
            {lookToast}
          </div>
        )}

        {/* CAM-1: the shot counter, and the burst as it runs. */}
        {!recording && !disposable && (burstCount !== null || shots.length > 0) && (
          <div
            className="pointer-events-none absolute left-1/2 top-[4.5rem] z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium tabular-nums backdrop-blur"
            aria-live="polite"
          >
            {burstCount !== null ? `Burst ${burstCount}` : `${shots.length} taken`}
          </div>
        )}

        {/* Recording pill */}
        {recording && (
          <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            {formatSeconds(recordSeconds)}
          </div>
        )}

        {/* Top controls. Sits above the starting spinner so the close button is
            never trapped behind a camera that is slow to open. */}
        {!error && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-4">
            <IconButton label="Close camera" onClick={cleanupAndClose}>
              <X className="h-5 w-5" />
            </IconButton>
            <div className="flex items-center gap-2">
              <IconButton
                label={`Flash ${flash}`}
                onClick={toggleFlash}
                active={flash !== "off"}
              >
                {flash === "off" ? (
                  <ZapOff className="h-5 w-5" />
                ) : (
                  <span className="relative">
                    <Zap className="h-5 w-5" />
                    {flash === "auto" && (
                      <span className="absolute -bottom-1 -right-1 text-[9px] font-bold">A</span>
                    )}
                  </span>
                )}
              </IconButton>
              <IconButton label="Grid and level" onClick={toggleGrid} active={grid}>
                <Grid3x3 className="h-5 w-5" />
              </IconButton>
              <IconButton
                label={`Timer ${timer}s`}
                onClick={() =>
                  setTimer(
                    (t) => TIMER_STEPS[(TIMER_STEPS.indexOf(t) + 1) % TIMER_STEPS.length],
                  )
                }
                active={timer !== 0}
              >
                <span className="relative">
                  <Timer className="h-5 w-5" />
                  {timer !== 0 && (
                    <span className="absolute -bottom-1 -right-1.5 text-[9px] font-bold">
                      {timer}
                    </span>
                  )}
                </span>
              </IconButton>
            </div>
          </div>
        )}

        {/* Error / permission state */}
        {error && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-black px-8 py-10 text-center"
            role="alert"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-canvas-line">
              <Camera className="h-7 w-7 text-muted" />
            </div>
            <div className="max-w-sm space-y-2">
              <p className="text-base font-medium text-paper">{error.message}</p>
              {error.help && <p className="text-sm leading-relaxed text-muted">{error.help}</p>}
            </div>
            <div className="flex w-full max-w-xs flex-col gap-2.5">
              <button
                onClick={() => void start()}
                className="min-h-11 rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-[0.96]"
              >
                Try again
              </button>
              {/* CAM-1: the way round. The phone's own camera app, which needs
                  no permission from this page, and the photo library. */}
              <button
                onClick={() => nativeCameraRef.current?.click()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-canvas-line px-5 text-sm font-medium text-paper transition-transform active:scale-[0.96]"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Use your phone&apos;s camera
              </button>
              {!disposable && (
                <button
                  onClick={() => libraryRef.current?.click()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-canvas-line px-5 text-sm font-medium text-paper transition-transform active:scale-[0.96]"
                >
                  <Images className="h-4 w-4" aria-hidden="true" />
                  Choose from your library
                </button>
              )}
              <button onClick={cleanupAndClose} className="min-h-11 text-sm text-muted">
                Close
              </button>
            </div>
            <input
              ref={nativeCameraRef}
              type="file"
              accept={allowVideo ? "image/*,video/*" : "image/*"}
              capture="environment"
              className="hidden"
              onChange={(event) => {
                handOverFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {!disposable && (
              <input
                ref={libraryRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm"
                multiple
                className="hidden"
                onChange={(event) => {
                  handOverFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            )}
          </div>
        )}

        {/* Zoom presets: tap to jump, pinch or double-tap for the rest */}
        {!error && !starting && zoomPresets.length > 1 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/40 p-1 backdrop-blur">
            {zoomPresets.map((f) => {
              const active = f === nearestPreset;
              return (
                <button
                  key={f}
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomPreset(f);
                  }}
                  className={`flex h-9 min-w-9 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums transition-colors ${
                    active ? "bg-volt text-on-volt" : "text-white/80"
                  }`}
                >
                  {active ? `${(zoom / zoomBase).toFixed(1)}×` : `${f}×`}
                </button>
              );
            })}
          </div>
        )}

        {starting && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-volt" />
          </div>
        )}
      </div>

      {/* Bottom control deck */}
      {!error && (
        <div className="shrink-0 bg-black px-6 pb-8 pt-4">
          {/* Looks: hidden only where video can't carry them */}
          {looksApplyHere && (
            <div className="-mx-6 mb-4 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {LOOKS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => selectLook(l.id, l.label)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    look === l.id ? "bg-volt text-on-volt" : "bg-white/10 text-paper"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}

          {/* Mode switch */}
          {allowVideo && (
            <div className="mb-4 flex items-center justify-center gap-6 text-sm font-medium">
              <button
                onClick={() => !recording && setMode("photo")}
                className={mode === "photo" ? "text-volt" : "text-white/50"}
              >
                Photo
              </button>
              <button
                onClick={() => !recording && setMode("video")}
                className={mode === "video" ? "text-volt" : "text-white/50"}
              >
                Video
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            {/* Last shot / tray thumbnail */}
            {disposable ? (
              // A frame counter, not a tray: on a disposable you do not get to
              // look back at what you shot until the roll develops.
              <div
                className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-canvas-line bg-canvas-raised"
                aria-live="polite"
                aria-label={`${Math.max(0, disposable.shotsLeft - shots.length)} shots left`}
              >
                <span className="text-lg font-bold tabular-nums leading-none text-paper">
                  {Math.max(0, disposable.shotsLeft - shots.length)}
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">left</span>
              </div>
            ) : (
            <button
              onClick={() => shots.length > 0 && setPreview(shots[shots.length - 1])}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised"
              aria-label="Review captures"
            >
              {shots.length > 0 ? (
                <>
                  {shots[shots.length - 1].kind === "video" ? (
                    <video
                      src={shots[shots.length - 1].url}
                      className="h-full w-full object-cover"
                      muted
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shots[shots.length - 1].url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-volt px-1 text-[11px] font-bold text-on-volt">
                    {shots.length}
                  </span>
                </>
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted">
                  <Camera className="h-5 w-5" />
                </span>
              )}
            </button>
            )}

            {/* Shutter */}
            <button
              // Pointer for taps and holds (burst); a click with no pointer
              // behind it is a keyboard or a screen reader, and shoots once.
              onPointerDown={shutterDown}
              onPointerUp={shutterUp}
              onPointerCancel={shutterCancel}
              onClick={(event) => {
                if (event.detail === 0) handleShutter();
              }}
              onContextMenu={(event) => event.preventDefault()}
              disabled={(busy && burstCount === null) || countdown !== null || starting || rollSpent}
              aria-label={
                rollSpent ? "Roll finished" : mode === "photo" ? "Take photo" : recording ? "Stop recording" : "Record"
              }
              className="group relative flex h-20 w-20 touch-none select-none items-center justify-center rounded-full disabled:opacity-60"
            >
              <span className="absolute inset-0 rounded-full border-4 border-white" />
              <span
                className={
                  mode === "video"
                    ? recording
                      ? "h-7 w-7 rounded-md bg-red-500 transition-all"
                      : "h-14 w-14 rounded-full bg-red-500 transition-all group-active:scale-90"
                    : "h-16 w-16 rounded-full bg-white transition-all group-active:scale-90"
                }
              />
            </button>

            {/* Flip camera */}
            <button
              onClick={switchCamera}
              disabled={recording}
              aria-label="Switch camera"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 transition-transform active:scale-90 disabled:opacity-40"
            >
              <SwitchCamera className="h-6 w-6" />
            </button>
          </div>

          {/* Done bar. Its space is kept even when empty: appearing after the
              first shot used to push the shutter up under a finger still on
              it, so the next tap, or the end of a burst, landed on "Add". */}
          <button
            onClick={finish}
            disabled={shots.length === 0 || recording || burstCount !== null}
            aria-hidden={shots.length === 0 || recording}
            tabIndex={shots.length === 0 || recording ? -1 : undefined}
            className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-volt py-3 text-sm font-semibold text-on-volt transition-transform active:scale-[0.98] ${
              shots.length === 0 || recording ? "invisible" : ""
            }`}
          >
            <Check className="h-4 w-4" />
            Add {shots.length} {shots.length === 1 ? "item" : "items"}
          </button>
        </div>
      )}

      {/* Review sheet */}
      {preview && (
        <div className="absolute inset-0 z-10 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-4">
            <IconButton label="Back" onClick={() => setPreview(null)}>
              <RotateCcw className="h-5 w-5" />
            </IconButton>
            <span className="text-sm text-muted">
              {shots.findIndex((s) => s.id === preview.id) + 1} of {shots.length}
            </span>
            <IconButton
              label="Delete"
              onClick={() => removeShot(preview.id)}
            >
              <Trash2 className="h-5 w-5" />
            </IconButton>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
            {preview.kind === "video" ? (
              <video src={preview.url} className="max-h-full max-w-full" controls autoPlay loop />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="" className="max-h-full max-w-full rounded-lg" />
            )}
          </div>
          {/* Filmstrip */}
          <div className="flex gap-2 overflow-x-auto px-4 pb-6 pt-2">
            {shots.map((s) => (
              <button
                key={s.id}
                onClick={() => setPreview(s)}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                  s.id === preview.id ? "border-volt" : "border-transparent"
                }`}
              >
                {s.kind === "video" ? (
                  <span className="flex h-full w-full items-center justify-center bg-canvas-raised">
                    <Video className="h-5 w-5 text-muted" />
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" className="h-full w-full object-cover" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur transition-transform active:scale-90 ${
        active ? "bg-volt text-on-volt" : "bg-black/40 text-paper"
      }`}
    >
      {children}
    </button>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
