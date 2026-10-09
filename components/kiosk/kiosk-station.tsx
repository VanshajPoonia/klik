"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { Camera, Expand, RotateCcw, SwitchCamera, X } from "lucide-react";
import { cameraSupported, capturePhoto, openStream, wallClock, type FacingMode } from "@/lib/camera";
import { DEFAULT_LOOK, lookById } from "@/lib/image-enhance";
import { UploadRefused, uploadToGallery } from "@/lib/upload-client";

type Step = "attract" | "camera" | "review" | "sending" | "done" | "error";

/**
 * How long each screen waits for someone before starting over. A guest who
 * walks away mid-shot leaves the kiosk ready for the next one, and a photo
 * nobody chose to keep is thrown away, never sent.
 */
const IDLE_MS: Record<Step, number | null> = {
  attract: null,
  camera: 60_000,
  review: 30_000,
  sending: null,
  done: 12_000,
  error: 30_000,
};
const COUNTDOWN_FROM = 3;

interface Shot {
  file: File;
  capturedAt: string;
  url: string;
  width: number;
  height: number;
}

function cameraMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked for this site. Allow it in the browser's settings for this site, then tap Try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "This device has no camera Klik can use.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then tap Try again.";
  return "The camera did not start. Tap Try again.";
}

/**
 * VEN-2: the kiosk itself. A tablet at the venue that does one thing: a guest
 * taps, gets a three second countdown, keeps or retakes the shot, and it goes
 * to the gallery through the same upload path as every phone. Then it shows
 * the gallery's QR code and starts over for the next person.
 *
 * Nothing here can reach the gallery, settings or another page. The server
 * holds the same line: a kiosk's cookie is sent back here from the gallery and
 * refused by every route that deletes. The camera is off whenever nobody is
 * using it, and the screen is kept awake.
 */
export function KioskStation({
  eventId,
  slug,
  eventName,
  qrDataUrl,
  shortUrl,
  moderated,
  team,
  consent,
}: {
  eventId: string;
  slug: string;
  eventName: string;
  qrDataUrl: string;
  shortUrl: string;
  /** The host reviews photos first, so "done" says it will show once seen. */
  moderated: boolean;
  /** The event's team is signed in on this device, and may leave kiosk mode. */
  team: boolean;
  /** The consent statement every uploader is shown, word for word. */
  consent: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<Step>("attract");
  const [facing, setFacing] = useState<FacingMode>("user");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [activity, setActivity] = useState(0);
  // Bumped by "Try again", so the camera effect runs once more.
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen] = useState(() => typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen));

  const discardShot = useCallback(() => {
    setShot((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  const startOver = useCallback(() => {
    setCountdown(null);
    setError(null);
    setCameraError(null);
    setProgress(0);
    discardShot();
    setStep("attract");
  }, [discardShot]);

  const openCamera = useCallback(() => {
    setCameraError(null);
    setError(null);
    discardShot();
    setStep("camera");
  }, [discardShot]);

  // The camera runs only while someone is framing a shot.
  useEffect(() => {
    if (step !== "camera") return;
    let cancelled = false;
    if (!cameraSupported()) {
      queueMicrotask(() => !cancelled && setCameraError("This browser cannot use the camera."));
      return;
    }
    openStream(facing)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => {});
        }
      })
      .catch((failure) => {
        if (!cancelled) setCameraError(cameraMessage(failure));
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [attempt, facing, step]);

  // Start over after a while with nobody touching it.
  useEffect(() => {
    const limit = IDLE_MS[step];
    if (!limit || countdown !== null) return;
    const timer = window.setTimeout(startOver, limit);
    return () => window.clearTimeout(timer);
  }, [activity, countdown, startOver, step]);

  // Keep the screen awake, and take the lock back after the tab comes back.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
        lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVisible = () => document.visibilityState === "visible" && void request();
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("fullscreenchange", onFullscreen);
      void lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => () => discardShot(), [discardShot]);

  const takeShot = useCallback(async () => {
    const video = videoRef.current;
    setCountdown(null);
    if (!video) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    // The preview is a mirror, which is how people expect to see themselves,
    // but the photo is saved the right way round, so a sign behind the group
    // reads properly in the gallery.
    const capturedAt = wallClock();
    const captured = await capturePhoto(video, { mirror: false, digitalZoom: 1, look: lookById(DEFAULT_LOOK) });
    if (!captured) {
      setCameraError("The camera did not give a picture. Tap Try again.");
      return;
    }
    const file = new File([captured.blob], `kiosk-${Date.now()}.jpg`, { type: "image/jpeg" });
    setShot({ file, capturedAt, url: URL.createObjectURL(captured.blob), width: captured.width, height: captured.height });
    setStep("review");
  }, []);

  // Three, two, one.
  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) void takeShot();
      else setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, takeShot]);

  async function send() {
    if (!shot) return;
    setStep("sending");
    setProgress(0);
    setError(null);
    try {
      await uploadToGallery({
        eventId,
        slug,
        mediaId: nanoid(),
        file: shot.file,
        prepared: { width: shot.width, height: shot.height },
        capturedAt: shot.capturedAt,
        // The server files it where the host chose for this kiosk.
        albumId: null,
        maxVideoSeconds: 0,
        onProgress: setProgress,
      });
      discardShot();
      setStep("done");
    } catch (failure) {
      const status = failure instanceof UploadRefused ? Number(failure.detail.status) : 0;
      if (status === 401) setSwitchedOff(true);
      setError(failure instanceof Error ? failure.message : "The photo did not send.");
      setStep("error");
    }
  }

  async function leave() {
    await fetch(`/api/e/${slug}/kiosk/leave`, { method: "POST" }).catch(() => null);
    router.replace(`/e/${slug}`);
  }

  if (switchedOff) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-8 text-center">
        <h1 className="font-display text-3xl text-paper">This kiosk has been switched off.</h1>
        <p className="mt-4 max-w-md text-muted">The host can set it up again from the event&apos;s QR code tab.</p>
      </main>
    );
  }

  return (
    <main
      className="relative flex min-h-dvh touch-manipulation select-none flex-col overflow-hidden bg-canvas text-paper"
      onPointerDown={() => setActivity((count) => count + 1)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {step === "attract" && (
        <button
          type="button"
          onClick={openCamera}
          className="flex flex-1 flex-col items-center justify-center gap-10 px-8 pb-64 pt-16 text-center sm:pb-40"
        >
          <span className="max-w-3xl font-display text-5xl leading-tight text-paper sm:text-7xl">{eventName}</span>
          <span className="inline-flex min-h-20 items-center gap-3 whitespace-nowrap rounded-full bg-volt px-8 text-xl font-semibold text-on-volt transition-transform active:scale-95 sm:gap-4 sm:px-12 sm:text-2xl">
            <Camera className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
            Tap to take a photo
          </span>
          <span className="max-w-xl text-base text-muted">It goes straight into the gallery for everyone here.</span>
        </button>
      )}

      {step === "attract" && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col-reverse items-start gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <p className="max-w-xl text-xs leading-relaxed text-muted">
            By taking a photo you agree: &ldquo;{consent}&rdquo; To have one taken down, ask the host. Terms and
            Privacy Policy at {shortUrl.split("/")[0]}.
          </p>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {canFullscreen && !fullscreen && (
              <button
                type="button"
                onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
                aria-label="Full screen"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-canvas-line text-muted"
              >
                <Expand className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {team && (
              <button
                type="button"
                onClick={() => void leave()}
                className="min-h-11 whitespace-nowrap rounded-full border border-canvas-line px-4 text-xs text-muted"
              >
                Leave kiosk mode
              </button>
            )}
          </div>
        </footer>
      )}

      {step === "camera" && (
        <div className="relative flex-1 bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
            className={`absolute inset-0 h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
          />
          {flash && <div className="absolute inset-0 bg-paper" aria-hidden="true" />}
          {countdown !== null && (
            <div className="absolute inset-0 flex items-center justify-center" role="status" aria-live="assertive">
              <span key={countdown} className="font-display text-[12rem] leading-none text-paper drop-shadow-lg">
                {countdown}
              </span>
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-canvas/95 px-8 text-center" role="alert">
              <p className="max-w-lg text-xl text-paper">{cameraError}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCameraError(null);
                    setAttempt((count) => count + 1);
                  }}
                  className="min-h-14 rounded-full bg-volt px-8 text-lg font-semibold text-on-volt"
                >
                  Try again
                </button>
                <button type="button" onClick={startOver} className="min-h-14 rounded-full border border-canvas-line px-8 text-lg text-paper">
                  Start over
                </button>
              </div>
            </div>
          )}
          {!cameraError && countdown === null && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-6 bg-gradient-to-t from-black/70 to-transparent px-8 pb-10 pt-16">
              <button
                type="button"
                onClick={startOver}
                aria-label="Cancel"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-paper"
              >
                <X className="h-7 w-7" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setCountdown(COUNTDOWN_FROM)}
                aria-label="Take the photo, in three seconds"
                className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-paper bg-volt transition-transform active:scale-90"
              >
                <Camera className="h-9 w-9 text-on-volt" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setFacing((current) => (current === "user" ? "environment" : "user"))}
                aria-label="Switch camera"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-paper"
              >
                <SwitchCamera className="h-7 w-7" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {step === "review" && shot && (
        <div className="relative flex flex-1 flex-col bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={shot.url} alt="The photo you just took" className="min-h-0 flex-1 object-contain" />
          <div className="flex items-center justify-center gap-4 px-8 pb-10 pt-6">
            <button
              type="button"
              onClick={openCamera}
              className="inline-flex min-h-16 items-center gap-3 rounded-full border border-canvas-line px-8 text-xl text-paper"
            >
              <RotateCcw className="h-6 w-6" aria-hidden="true" />
              Retake
            </button>
            <button
              type="button"
              onClick={() => void send()}
              className="min-h-16 rounded-full bg-volt px-10 text-xl font-semibold text-on-volt transition-transform active:scale-95"
            >
              Add to the gallery
            </button>
          </div>
        </div>
      )}

      {step === "sending" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8" role="status">
          <p className="font-display text-4xl text-paper">Sending it to the gallery…</p>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-canvas-line">
            <div className="h-full bg-volt transition-[width] duration-300" style={{ width: `${Math.round(progress)}%` }} />
          </div>
        </div>
      )}

      {step === "done" && (
        <button
          type="button"
          onClick={startOver}
          className="flex flex-1 flex-col items-center justify-center gap-8 px-8 text-center"
          aria-label="Start again for the next guest"
        >
          <span className="font-display text-5xl text-paper" role="status">
            {moderated ? "Done. The host will add it shortly." : "Done. It's in the gallery."}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the server */}
          <img src={qrDataUrl} alt={`QR code for ${shortUrl}`} className="h-56 w-56 rounded-2xl" />
          <span className="max-w-lg text-xl text-paper">Scan to see every photo, and add your own from your phone.</span>
          <span className="text-sm text-muted">Tap anywhere for the next guest</span>
        </button>
      )}

      {step === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center" role="alert">
          <p className="max-w-lg font-display text-3xl text-paper">That photo did not send.</p>
          {error && <p className="max-w-lg text-muted">{error}</p>}
          <div className="flex gap-3">
            {shot && (
              <button
                type="button"
                onClick={() => void send()}
                className="min-h-14 rounded-full bg-volt px-8 text-lg font-semibold text-on-volt"
              >
                Try again
              </button>
            )}
            <button type="button" onClick={startOver} className="min-h-14 rounded-full border border-canvas-line px-8 text-lg text-paper">
              Start over
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
