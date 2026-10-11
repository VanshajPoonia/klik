"use client";

import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Clapperboard, Download, Music, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REEL, coverRect, detectTempo, frameAt, kenBurns, planReel, type ReelPlan } from "@/lib/reel";
import { uploadToGallery } from "@/lib/upload-client";

/**
 * GRW-2: a 30-second vertical reel of the highlights, made on this device.
 *
 * Rendered in the browser with WebCodecs and muxed to MP4 by mediabunny, so
 * nothing runs on a server, nothing waits on a provider, and the music the
 * host chooses never leaves their device except inside the finished video.
 * Klik ships no music: a host may add their own, at their own risk, and is
 * told so (section C). The result can be downloaded for a story, or added to
 * the gallery, where it is an ordinary video: shared, downloaded and
 * streamed like any other.
 */

export interface ReelPhoto {
  id: string;
  /** The content route, which checks access and redirects to the photo. */
  blobUrl: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string; progress: number }
  | { kind: "done"; blob: Blob; url: string; silent: boolean; tempo: boolean }
  | { kind: "error"; message: string };

const LONG_EDGE = 1600;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

async function loadPhoto(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const probe = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const scale = Math.min(1, LONG_EDGE / Math.max(probe.width, probe.height));
    if (scale === 1) return probe;
    probe.close();
    return createImageBitmap(blob, {
      imageOrientation: "from-image",
      resizeWidth: Math.round(probe.width * scale),
      resizeHeight: Math.round(probe.height * scale),
      resizeQuality: "high",
    });
  } catch {
    return null;
  }
}

/** Lines that fit `width`, at most `max` of them, the last cut with an ellipsis. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].replace(/\s+\S*$/, "")}…`;
    return kept;
  }
  return lines;
}

export function ReelMaker({
  eventId,
  slug,
  eventName,
  eventDate,
  accent,
  branding,
  galleryUrl,
  photos,
  maxVideoSeconds,
}: {
  eventId: string;
  slug: string;
  eventName: string;
  eventDate: string | null;
  accent: string;
  branding: boolean;
  galleryUrl: string;
  photos: ReelPhoto[];
  maxVideoSeconds: number;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [music, setMusic] = useState<File | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const cancelled = useRef(false);
  const usable = photos.slice(0, REEL.maxPhotos);

  // A finished reel holds a few megabytes as an object URL until it is replaced.
  useEffect(() => {
    return () => {
      if (phase.kind === "done") URL.revokeObjectURL(phase.url);
    };
  }, [phase]);

  async function make() {
    cancelled.current = false;
    setSaving("idle");
    const fail = (message: string) => setPhase({ kind: "error", message });
    const mediabunny = await import("mediabunny");
    if (typeof VideoEncoder === "undefined" || !(await mediabunny.canEncodeVideo("avc", { width: REEL.width, height: REEL.height, frameRate: REEL.fps }))) {
      return fail("This browser cannot make videos. Try Chrome, Edge or Safari on a computer.");
    }

    setPhase({ kind: "working", step: "Gathering the photos", progress: 0 });
    const images = (await Promise.all(usable.map((photo) => loadPhoto(photo.blobUrl)))).filter((image): image is ImageBitmap => Boolean(image));
    if (images.length < REEL.minPhotos) return fail("Too few of the highlights could be loaded. Try again in a moment.");

    // Music, when chosen: its tempo sets the cuts, and it fades at the end.
    let tempo = null;
    let audio: AudioBuffer | null = null;
    let decoded: AudioBuffer | null = null;
    if (music) {
      setPhase({ kind: "working", step: "Listening to the music", progress: 0 });
      try {
        const context = new AudioContext();
        decoded = await context.decodeAudioData(await music.arrayBuffer());
        await context.close();
        const mono = decoded.getChannelData(0);
        const step = Math.max(1, Math.round(decoded.sampleRate / 22050));
        const sampled = new Float32Array(Math.floor(Math.min(mono.length, decoded.sampleRate * 60) / step));
        for (let index = 0; index < sampled.length; index += 1) sampled[index] = mono[index * step];
        tempo = detectTempo(sampled, decoded.sampleRate / step);
      } catch {
        return fail("That music file could not be read. Try an MP3 or M4A.");
      }
    }
    const plan: ReelPlan = planReel(images.length, tempo);
    if (decoded) {
      const sampleRate = 48_000;
      const offline = new OfflineAudioContext(2, Math.ceil(plan.duration * sampleRate), sampleRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(1, Math.max(0, plan.duration - REEL.fadeOut));
      gain.gain.linearRampToValueAtTime(0, plan.duration);
      source.connect(gain).connect(offline.destination);
      source.start(0);
      audio = await offline.startRendering();
    }
    const audioCodec = audio
      ? (await mediabunny.canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }))
        ? "aac"
        : (await mediabunny.canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: 48_000 }))
          ? "opus"
          : null
      : null;

    // The page's own fonts and colours, so the cards look like Klik.
    const display = cssVar("--font-fraunces", "Georgia, serif");
    const sans = cssVar("--font-geist-sans", "system-ui, sans-serif");
    await Promise.all([document.fonts.load(`600 96px ${display}`), document.fonts.load(`400 40px ${sans}`)]).catch(() => undefined);
    const colours = {
      canvas: cssVar("--color-canvas", "#050505"),
      paper: cssVar("--color-paper", "#f3f1e9"),
      muted: cssVar("--color-muted", "#8c8a80"),
      accent,
    };
    const QRCode = (await import("qrcode")).default;
    const qr = await createImageBitmap(
      await (await fetch(await QRCode.toDataURL(galleryUrl, { margin: 1, width: 360, color: { dark: "#050505", light: "#ffffff" } }))).blob(),
    );

    const canvas = document.createElement("canvas");
    canvas.width = REEL.width;
    canvas.height = REEL.height;
    const context = canvas.getContext("2d", { alpha: false })!;

    const drawPhoto = (index: number, progress: number, alpha: number) => {
      const image = images[index];
      if (!image || alpha <= 0) return;
      context.globalAlpha = alpha;
      const rect = coverRect(image.width, image.height, REEL.width, REEL.height, kenBurns(index, progress));
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      context.globalAlpha = 1;
    };
    const centred = (text: string, y: number, font: string, colour: string) => {
      context.font = font;
      context.fillStyle = colour;
      context.textAlign = "center";
      context.fillText(text, REEL.width / 2, y);
    };
    const drawTitle = (progress: number) => {
      context.globalAlpha = Math.min(1, progress * 4);
      centred("HIGHLIGHTS", 760, `500 34px ${sans}`, colours.accent);
      context.font = `600 104px ${display}`;
      const lines = wrap(context, eventName, 900, 3);
      lines.forEach((line, index) => centred(line, 900 + index * 120, `600 104px ${display}`, colours.paper));
      if (eventDate) centred(eventDate, 900 + lines.length * 120 + 40, `400 42px ${sans}`, colours.muted);
      context.globalAlpha = 1;
    };
    const drawEnd = (progress: number) => {
      context.globalAlpha = Math.min(1, progress * 3);
      centred("Every photo from the day", 700, `600 72px ${display}`, colours.paper);
      context.drawImage(qr, (REEL.width - 360) / 2, 800, 360, 360);
      centred(galleryUrl.replace(/^https?:\/\//, ""), 1240, `400 38px ${sans}`, colours.muted);
      if (branding) centred("Made with Klik", 1720, `500 34px ${sans}`, colours.accent);
      context.globalAlpha = 1;
    };

    try {
      const output = new mediabunny.Output({
        format: new mediabunny.Mp4OutputFormat({ fastStart: "in-memory" }),
        target: new mediabunny.BufferTarget(),
      });
      const video = new mediabunny.CanvasSource(canvas, { codec: "avc", quality: mediabunny.QUALITY_HIGH, keyFrameInterval: 2 });
      output.addVideoTrack(video, { frameRate: REEL.fps });
      const sound = audioCodec ? new mediabunny.AudioBufferSource({ codec: audioCodec, quality: mediabunny.QUALITY_HIGH }) : null;
      if (sound) output.addAudioTrack(sound);
      await output.start();

      const frames = Math.ceil(plan.duration * REEL.fps);
      for (let index = 0; index < frames; index += 1) {
        if (cancelled.current) {
          await output.cancel();
          setPhase({ kind: "idle" });
          return;
        }
        const t = index / REEL.fps;
        const frame = frameAt(plan, t);
        context.fillStyle = colours.canvas;
        context.fillRect(0, 0, REEL.width, REEL.height);
        if (frame.kind === "title") {
          drawTitle(frame.progress);
          // The first photo rises under the title's last moment.
          const first = plan.shots[0];
          if (first && first.start - t < REEL.crossfade) drawPhoto(first.photo, 0, 1 - (first.start - t) / REEL.crossfade);
        } else if (frame.kind === "shot") {
          drawPhoto(frame.shot.photo, frame.progress, 1);
          if (frame.next) drawPhoto(frame.next.shot.photo, 0, frame.next.mix);
        } else {
          drawEnd(frame.progress);
          if (frame.fromShot) drawPhoto(frame.fromShot.shot.photo, 1, frame.fromShot.mix);
        }
        await video.add(t, 1 / REEL.fps);
        if (index % 15 === 0) setPhase({ kind: "working", step: "Making the video", progress: index / frames });
      }
      if (sound && audio) await sound.add(audio);
      await output.finalize();
      const buffer = (output.target as InstanceType<typeof mediabunny.BufferTarget>).buffer;
      if (!buffer) return fail("The video came out empty. Try again.");
      const blob = new Blob([buffer], { type: "video/mp4" });
      setPhase({ kind: "done", blob, url: URL.createObjectURL(blob), silent: Boolean(music) && !audioCodec, tempo: Boolean(tempo) });
    } catch (error) {
      fail(error instanceof Error ? `The video could not be made: ${error.message}` : "The video could not be made.");
    } finally {
      images.forEach((image) => image.close());
      qr.close();
    }
  }

  async function save() {
    if (phase.kind !== "done") return;
    setSaving("saving");
    try {
      await uploadToGallery({
        eventId,
        slug,
        mediaId: nanoid(),
        file: new File([phase.blob], "highlight-reel.mp4", { type: "video/mp4" }),
        maxVideoSeconds,
      });
      setSaving("saved");
    } catch {
      setSaving("failed");
    }
  }

  const filename = `${eventName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "klik"}-highlights.mp4`;

  return (
    <section className="space-y-4 rounded-2xl border border-canvas-line bg-canvas-raised p-4" aria-labelledby="reel-heading">
      <div>
        <h2 id="reel-heading" className="flex items-center gap-2 text-sm font-medium text-paper">
          <Clapperboard className="h-4 w-4 text-volt" aria-hidden="true" />
          Highlight reel
        </h2>
        <p className="mt-1 text-sm text-muted">
          A vertical video of these highlights, up to {REEL.targetSeconds} seconds and sized for stories, with your own
          music if you like. It is made on this device, so keep this tab open while it works.
        </p>
      </div>

      {usable.length < REEL.minPhotos ? (
        <p className="text-sm text-muted">It needs at least {REEL.minPhotos} highlights. They appear as guests share photos.</p>
      ) : phase.kind === "working" ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm text-paper">{phase.step}…</p>
          <div className="h-2 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-volt transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => (cancelled.current = true)}>
            Stop
          </Button>
        </div>
      ) : phase.kind === "done" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <video src={phase.url} controls playsInline className="aspect-[9/16] w-48 shrink-0 rounded-xl border border-canvas-line bg-canvas" />
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              {phase.silent
                ? "This browser cannot add music, so the reel is silent."
                : music
                  ? phase.tempo
                    ? "Every cut lands on the beat."
                    : "The music had no clear beat, so the photos are evenly spaced."
                  : "No music. Start over to add some."}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={phase.url}
                download={filename}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-volt px-4 text-sm font-medium text-on-volt transition-transform active:scale-95"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </a>
              <Button variant="ghost" size="sm" disabled={saving === "saving" || saving === "saved"} onClick={() => void save()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {saving === "saving" ? "Adding…" : saving === "saved" ? "In the gallery" : "Add to the gallery"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "idle" })}>
                Start over
              </Button>
            </div>
            {saving === "saved" && (
              <p className="text-xs text-muted">It is in the gallery as a video. Hide it from the gallery tab if you would rather keep it to yourself.</p>
            )}
            {saving === "failed" && <p className="text-xs text-red-400">It could not be added. Try again, or download it instead.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-canvas-line px-4 text-paper hover:border-volt/50">
              <Music className="h-4 w-4" aria-hidden="true" />
              {music ? music.name : "Add music"}
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => setMusic(event.target.files?.[0] ?? null)}
              />
            </span>
            {music && (
              <button type="button" onClick={() => setMusic(null)} className="min-h-11 px-2 text-xs underline-offset-2 hover:underline">
                No music
              </button>
            )}
          </label>
          <p className="text-xs text-muted">
            Use music you have the right to share. Klik does not provide any, and songs from streaming services usually
            cannot be posted.
          </p>
          {phase.kind === "error" && (
            <p className="text-sm text-red-400" role="alert">
              {phase.message}
            </p>
          )}
          <Button onClick={() => void make()}>Make the reel</Button>
        </div>
      )}
    </section>
  );
}
