"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Expand, Loader2, RotateCcw, SwitchCamera, WifiOff, X } from "lucide-react";
import { cameraSupported, capturePhoto, openStream, wallClock, type FacingMode } from "@/lib/camera";
import { DEFAULT_LOOK, lookById } from "@/lib/image-enhance";
import { useUploadQueue } from "@/components/upload/use-upload-queue";
import { useGuestCopy } from "@/components/guest/guest-copy";
import type { GuestCopy } from "@/lib/i18n/guest";

type Step = "attract" | "camera" | "review" | "done";

/**
 * How long each screen waits for someone before starting over. A guest who
 * walks away mid-shot leaves the kiosk ready for the next one, and a photo
 * nobody chose to keep is thrown away, never sent.
 */
const IDLE_MS: Record<Step, number | null> = {
  attract: null,
  camera: 60_000,
  review: 30_000,
  done: 12_000,
};
const COUNTDOWN_FROM = 3;

interface Shot {
  file: File;
  capturedAt: string;
  url: string;
  width: number;
  height: number;
}

function cameraMessage(t: GuestCopy, error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return t.kiosk.cameraBlocked;
  if (name === "NotFoundError" || name === "OverconstrainedError") return t.kiosk.noCamera;
  if (name === "NotReadableError") return t.kiosk.cameraBusy;
  return t.kiosk.cameraFailed;
}

/**
 * VEN-2: the kiosk itself. A tablet at the venue that does one thing: a guest
 * taps, gets a three second countdown, keeps or retakes the shot, and it goes
 * to the gallery through the same upload queue as every phone (OPS-3), so a
 * guest never waits on the venue's wifi: the shot is kept on the tablet and
 * sent from there, and the next guest can start straight away. Then it shows
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
  // TRS-3: the tablet's language, chosen by the page.
  const { t } = useGuestCopy();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<Step>("attract");
  const [facing, setFacing] = useState<FacingMode>("user");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // The shot the done screen is about, so it can say whether it has landed.
  const [sentId, setSentId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const uploads = useUploadQueue({ eventId, slug, albumId: null, maxVideoSeconds: 0 });
  // The server refuses a kiosk the host switched off as unauthorised.
  const switchedOff = uploads.items.some((item) => item.status401);
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
    setCameraError(null);
    setSentId(null);
    discardShot();
    setStep("attract");
  }, [discardShot]);

  const openCamera = useCallback(() => {
    setCameraError(null);
    discardShot();
    setStep("camera");
  }, [discardShot]);

  // The camera runs only while someone is framing a shot.
  useEffect(() => {
    if (step !== "camera") return;
    let cancelled = false;
    if (!cameraSupported()) {
      queueMicrotask(() => !cancelled && setCameraError(t.kiosk.cameraUnsupported));
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
        if (!cancelled) setCameraError(cameraMessage(t, failure));
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [attempt, facing, step, t]);

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
      setCameraError(t.kiosk.noPicture);
      return;
    }
    const file = new File([captured.blob], `kiosk-${Date.now()}.jpg`, { type: "image/jpeg" });
    setShot({ file, capturedAt, url: URL.createObjectURL(captured.blob), width: captured.width, height: captured.height });
    setStep("review");
  }, [t]);

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
    // Kept on this tablet first, then sent: the guest is done the moment they
    // tap, whatever the wifi is doing. The server files it where the host
    // chose for this kiosk.
    const [id] = await uploads.enqueue([
      { file: shot.file, prepared: { width: shot.width, height: shot.height }, capturedAt: shot.capturedAt },
    ]);
    setSentId(id ?? null);
    discardShot();
    setStep("done");
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

  // Whether the shot just taken has landed, is on its way, or is waiting for the wifi.
  const sentItem = sentId ? uploads.items.find((item) => item.id === sentId) : undefined;
  const doneMessage = !sentItem
    ? moderated
      ? t.kiosk.doneModerated
      : t.kiosk.doneInGallery
    : sentItem.status === "refused"
      ? t.kiosk.savedRefused
      : uploads.online
        ? t.kiosk.doneOnItsWay
        : t.kiosk.savedOffline;

  // For whoever looks after the tablet: what is still to send, and anything refused.
  const waiting = uploads.items.filter((item) => item.status !== "refused");
  const refused = uploads.items.filter((item) => item.status === "refused");

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
            {t.kiosk.tapToStart}
          </span>
          <span className="max-w-xl text-base text-muted">It goes straight into the gallery for everyone here.</span>
        </button>
      )}

      {step === "attract" && (waiting.length > 0 || refused.length > 0) && (
        <div className="absolute inset-x-0 top-0 flex justify-end p-6">
          <div className="max-w-md rounded-2xl border border-canvas-line bg-canvas-raised/95 px-4 py-3 text-sm" role="status" aria-live="polite">
            {refused.length > 0 ? (
              <button type="button" onClick={() => setQueueOpen((open) => !open)} className="flex items-center gap-2 text-left text-paper" aria-expanded={queueOpen}>
                <AlertCircle className="h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
                {t.kiosk.refused(refused.length)}
              </button>
            ) : (
              <p className="flex items-center gap-2 text-muted">
                {uploads.online ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-volt" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                {uploads.online
                  ? t.kiosk.sending(waiting.length)
                  : t.kiosk.waitingForWifi(waiting.length)}
              </p>
            )}
            {queueOpen && refused.length > 0 && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted">{refused[0].message ?? "The gallery did not take them."}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => refused.forEach((item) => void uploads.retry(item.id))}
                    className="min-h-11 rounded-full bg-volt px-4 text-xs font-semibold text-on-volt"
                  >
                    {t.common.tryAgain}
                  </button>
                  {team && (
                    <button
                      type="button"
                      onClick={() => {
                        refused.forEach((item) => void uploads.remove(item.id));
                        setQueueOpen(false);
                      }}
                      className="min-h-11 rounded-full border border-canvas-line px-4 text-xs text-muted"
                    >
                      {t.kiosk.discard(refused.length)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "attract" && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col-reverse items-start gap-4 p-6 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <p className="max-w-xl text-xs leading-relaxed text-muted">
            {t.kiosk.consentBefore} &ldquo;{consent}&rdquo; {t.kiosk.consentAfter(shortUrl.split("/")[0])}
          </p>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {canFullscreen && !fullscreen && (
              <button
                type="button"
                onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
                aria-label={t.kiosk.fullScreen}
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
                {t.kiosk.leave}
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
            aria-label={t.kiosk.preview}
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
                  {t.common.tryAgain}
                </button>
                <button type="button" onClick={startOver} className="min-h-14 rounded-full border border-canvas-line px-8 text-lg text-paper">
                  {t.kiosk.startOver}
                </button>
              </div>
            </div>
          )}
          {!cameraError && countdown === null && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-6 bg-gradient-to-t from-black/70 to-transparent px-8 pb-10 pt-16">
              <button
                type="button"
                onClick={startOver}
                aria-label={t.common.cancel}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-paper"
              >
                <X className="h-7 w-7" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setCountdown(COUNTDOWN_FROM)}
                aria-label={t.kiosk.takeIn3}
                className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-paper bg-volt transition-transform active:scale-90"
              >
                <Camera className="h-9 w-9 text-on-volt" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setFacing((current) => (current === "user" ? "environment" : "user"))}
                aria-label={t.kiosk.switchCamera}
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
              {t.kiosk.retake}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              className="min-h-16 rounded-full bg-volt px-10 text-xl font-semibold text-on-volt transition-transform active:scale-95"
            >
              {t.kiosk.addToGallery}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <button
          type="button"
          onClick={startOver}
          className="flex flex-1 flex-col items-center justify-center gap-8 px-8 text-center"
          aria-label={t.kiosk.nextGuest}
        >
          <span className="max-w-3xl font-display text-5xl text-paper" role="status">
            {doneMessage}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the server */}
          <img src={qrDataUrl} alt={`QR code for ${shortUrl}`} className="h-56 w-56 rounded-2xl" />
          <span className="max-w-lg text-xl text-paper">Scan to see every photo, and add your own from your phone.</span>
          <span className="text-sm text-muted">Tap anywhere for the next guest</span>
        </button>
      )}
    </main>
  );
}
