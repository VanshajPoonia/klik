/**
 * Videos made smaller, and playable in every browser, on the uploader's own
 * device before a byte is sent, the way photos already are.
 *
 * **Why on the device.** A phone films 4K at 60 frames in HEVC: around 170 MB
 * a minute, in a format Chrome on a PC without HEVC cannot show. Converting
 * on the server means a function that holds a 500 MB file for minutes, which
 * Vercel's limits rule out, or paying Stream to do it. The phone that filmed
 * it has hardware made for exactly this, and WebCodecs reaches it from the
 * page, so the server only ever sees the small copy.
 *
 * **What comes out.** H.264 and AAC in an MP4, which every browser plays, no
 * larger than 1080p (1920 on the long edge), no faster than 30 frames, at
 * about 4.7 Mbps at full size: around 35 MB a minute, against roughly 60 for
 * an iPhone's own 1080p and 170 for its 4K. No metadata is written, so the
 * location is gone before it leaves the phone (the server still checks).
 * The one thing worth keeping from it, when the clip was filmed, is read
 * first and sent alongside, as the server's scrub would have read it.
 *
 * **When it does nothing**, and the original goes as it always has: a clip
 * already H.264 at no more than 1080p, 30 frames and 8 Mbps (what Klik's own
 * camera records); a browser without WebCodecs, or one that cannot decode the
 * clip or encode H.264 or AAC; or any failure along the way. Losing the sound
 * or the picture is never an acceptable result, so a conversion that would
 * drop either track is not run.
 */

import { quicktimeWallTime } from "./exif";

/** The long edge of what is kept: 1080p. */
export const VIDEO_MAX_EDGE = 1920;
/** Frames a second kept: 60 doubles the size for motion nobody sees in a gallery. */
export const VIDEO_MAX_FPS = 30;
/** Above this, a clip that is otherwise fine is re-encoded to bring it down. */
const KEEP_BELOW_BITS_PER_SECOND = 8_000_000;
/** What a full 1080p picture is encoded at: around 35 MB a minute with the sound. */
const FULL_SIZE_BITS_PER_SECOND = 4_700_000;
/** The floor, below which H.264 smears faces. */
const MIN_BITS_PER_SECOND = 600_000;
/** A conversion that reports nothing for this long has stalled, and is given up. */
const STALL_MS = 30_000;
/** Reading a clip and setting up takes about a second; past this, something has hung. */
const SETUP_MS = 60_000;

/** The size a clip comes out at: its long edge brought down to the cap, both sides even, as H.264 needs. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VIDEO_MAX_EDGE / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * The rate a picture of this size is encoded at: about 4.7 Mbps at 1080p,
 * scaled with the pixels, and never far above what the clip had, because
 * re-encoding a light clip heavier only makes it bigger. HEVC and VP9 need
 * about 0.6 of H.264's rate for the same picture, so 1.7 times theirs looks
 * the same.
 */
export function targetBitrate(width: number, height: number, inputBitsPerSecond: number): number {
  const full = FULL_SIZE_BITS_PER_SECOND * Math.pow((width * height) / (1920 * 1080), 0.95);
  return Math.round(Math.max(MIN_BITS_PER_SECOND, Math.min(full, inputBitsPerSecond * 1.7)));
}

export interface ClipFacts {
  codec: string | null;
  width: number;
  height: number;
  framesPerSecond: number;
  bitsPerSecond: number;
  container: string;
  audioCodec: string | null;
}

/** Whether the picture itself has to be re-encoded: not H.264, too big, too fast or too heavy. */
export function pictureNeedsEncoding(clip: ClipFacts): boolean {
  return (
    clip.codec !== "avc" ||
    Math.max(clip.width, clip.height) > VIDEO_MAX_EDGE ||
    clip.framesPerSecond > VIDEO_MAX_FPS + 1 ||
    clip.bitsPerSecond > KEEP_BELOW_BITS_PER_SECOND
  );
}

/** Whether anything about the clip is worth changing. A sound or container change alone copies the picture across. */
export function needsConversion(clip: ClipFacts): boolean {
  return (
    pictureNeedsEncoding(clip) ||
    !/^video\/(mp4|quicktime)/.test(clip.container) ||
    (clip.audioCodec !== null && clip.audioCodec !== "aac")
  );
}

/**
 * The phone paused the page while a clip was converting (the screen locked,
 * the guest switched apps) and the conversion did not survive it: a browser
 * can take its video hardware back from a page in the background. Not a sign
 * that this device cannot convert, so the clip waits and is converted again
 * when the page is back, rather than going up unconverted.
 */
export class ConversionInterrupted extends Error {
  constructor() {
    super("The video's conversion was interrupted");
    this.name = "ConversionInterrupted";
  }
}

type ScreenLock = { release: () => Promise<void> };

/** The conversion before this one, so they run one at a time. */
let turn: Promise<unknown> = Promise.resolve();

export interface CompressedVideo {
  file: Blob;
  /** An iPhone's own local capture time, as wall time, read before the metadata went. */
  capturedAt: string | null;
}

/**
 * The smaller H.264 copy, or null to send the original. Throws only
 * `ConversionInterrupted`, to be tried again when the page is back.
 * `onProgress` gets a fraction between 0 and 1 as the clip is converted.
 *
 * One at a time: a phone has one hardware encoder, and two clips sharing it
 * each take twice as long, so the first is ready to send no sooner.
 */
export function compressVideoForUpload(
  file: Blob,
  options: { onProgress?: (fraction: number) => void } = {},
): Promise<CompressedVideo | null> {
  const run = turn.then(() => convert(file, options));
  turn = run.catch(() => null);
  return run;
}

/**
 * Whether a converted copy holds the whole clip: it can be read back, has its
 * picture, kept its sound if there was any, and runs to within half a second
 * (or 2% of a long clip) of the original. Anything less is a guest's video cut
 * short, and the original goes instead.
 */
export function isWholeClip(copy: { seconds: number; picture: boolean; sound: boolean }, original: { seconds: number; sound: boolean }) {
  return copy.picture && (copy.sound || !original.sound) && copy.seconds >= original.seconds - Math.max(0.5, original.seconds * 0.02);
}

async function convert(file: Blob, options: { onProgress?: (fraction: number) => void }): Promise<CompressedVideo | null> {
  // The stall watchdog below starts with the conversion. Before that, a file
  // that hangs the reader would hold every later clip behind it, since they
  // run one at a time, so setting up has a limit of its own. A page in the
  // background is paused, not hung, and gets its time back.
  const state = { converting: false };
  const watch: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
  const hung = new Promise<"hung">((resolve) => {
    const arm = () => {
      watch.timer = setTimeout(() => {
        if (state.converting) return;
        if (document.hidden) arm();
        else resolve("hung");
      }, SETUP_MS);
    };
    if (typeof window !== "undefined") arm();
  });
  try {
    const work = attempt(file, options, state);
    // One given up as hung may still fail later, when nobody is listening.
    work.catch(() => {});
    const result = await Promise.race([work, hung]);
    return result === "hung" ? null : result;
  } finally {
    if (watch.timer) clearTimeout(watch.timer);
  }
}

async function attempt(
  file: Blob,
  options: { onProgress?: (fraction: number) => void },
  state: { converting: boolean },
): Promise<CompressedVideo | null> {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return null;
  }
  let input: import("mediabunny").Input | null = null;
  let stall: ReturnType<typeof setTimeout> | null = null;
  // Whether the page went into the background at any point while converting.
  let interrupted = document.hidden;
  // The screen kept on while converting, so a phone put down on the table
  // does not lock itself halfway; the browser drops the lock whenever the
  // page is hidden, so it is taken again when the page is back.
  const screen: { lock: ScreenLock | null; wanted: boolean } = { lock: null, wanted: false };
  const keepAwake = async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<ScreenLock> } };
      const lock = (await nav.wakeLock?.request("screen")) ?? null;
      // Granted after the conversion finished: not wanted any more.
      if (!screen.wanted) void lock?.release().catch(() => {});
      else screen.lock = lock;
    } catch {
      screen.lock = null;
    }
  };
  const onVisibility = () => {
    if (document.hidden) interrupted = true;
    else if (screen.wanted) void keepAwake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  try {
    const mediabunny = await import("mediabunny");
    input = new mediabunny.Input({ source: new mediabunny.BlobSource(file), formats: mediabunny.ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    // An iPhone that records spatial audio stores it beside an ordinary AAC
    // track, and the primary track is the heavier one: the spatial one, which
    // no browser decodes. The AAC one is the sound everyone hears.
    const audio = (await input.getAudioTracks()).find((track) => track.codec === "aac") ?? (await input.getPrimaryAudioTrack());
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const stats = await video.computePacketStats(120);
    const clip: ClipFacts = {
      codec: video.codec,
      width: video.displayWidth,
      height: video.displayHeight,
      framesPerSecond: stats.averagePacketRate,
      bitsPerSecond: (file.size * 8) / duration,
      container: (await input.getFormat()).mimeType,
      audioCodec: audio?.codec ?? null,
    };
    if (!needsConversion(clip)) return null;

    // Only what is re-encoded has to be decoded. An iPhone's sound is AAC
    // already and is copied across untouched, which matters because Safari
    // gained WebCodecs audio much later than video.
    const encodePicture = pictureNeedsEncoding(clip);
    const encodeSound = audio !== null && (audio.codec !== "aac" || audio.numberOfChannels > 2);
    if (encodePicture && !(await video.canDecode())) return null;
    if (encodeSound && !(await audio.canDecode())) return null;
    const size = targetSize(clip.width, clip.height);
    const frameRate = clip.framesPerSecond > VIDEO_MAX_FPS + 1 ? VIDEO_MAX_FPS : undefined;
    // The sound is about 128 kbps of what the file carries; the rest is picture.
    const bitrate = targetBitrate(size.width, size.height, clip.bitsPerSecond - (audio ? 128_000 : 0));
    if (encodePicture && !(await mediabunny.canEncodeVideo("avc", { ...size, bitrate }))) return null;
    const channels = Math.min(2, audio?.numberOfChannels ?? 2);
    if (encodeSound && !(await mediabunny.canEncodeAudio("aac", { numberOfChannels: channels, sampleRate: audio.sampleRate }))) {
      return null;
    }

    // The same field and the same reading as the server's scrub (lib/video-metadata.ts).
    const created = (await input.getMetadataTags()).raw?.["com.apple.quicktime.creationdate"];
    const capturedAt = typeof created === "string" ? quicktimeWallTime(created) : null;

    const target = new mediabunny.BufferTarget();
    const output = new mediabunny.Output({
      // The index at the front, so playback starts before the whole file arrives.
      format: new mediabunny.Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const picture: import("mediabunny").ConversionVideoOptions = encodePicture
      ? {
          codec: "avc",
          ...size,
          fit: "fill",
          ...(frameRate ? { frameRate } : {}),
          // A set rate rather than constant quality, so the size is predictable.
          quality: new mediabunny.Quality({ bitrate }),
          // Upright pixels rather than a rotation flag, which some players
          // ignore and which would make the size above mean the wrong side.
          allowTransformationMetadata: false,
          forceTranscode: true,
        }
      : { codec: "avc" };
    const sound: import("mediabunny").ConversionAudioOptions = encodeSound
      ? { codec: "aac", numberOfChannels: channels }
      : { codec: "aac" };
    const conversion = await mediabunny.Conversion.init({
      input,
      output,
      // The chosen picture and sound; everything else (spatial audio, other
      // angles) is left out on purpose.
      tracks: "all",
      video: (track) => (track.id === video.id ? picture : { discard: true }),
      audio: (track) => (track.id === audio?.id ? sound : { discard: true }),
      // Nothing from the original's metadata: that is where the location is.
      tags: {},
      showWarnings: false,
    });
    // Losing the chosen picture or sound for any reason means sending the original.
    if (!conversion.isValid || conversion.discardedTracks.some((dropped) => dropped.reason !== "discarded_by_user")) return null;

    // A page in the background is paused, not stalled: the guest switched
    // apps, and the conversion carries on when they come back.
    const restartStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => (document.hidden ? restartStall() : void conversion.cancel()), STALL_MS);
    };
    conversion.onProgress = (progress) => {
      restartStall();
      options.onProgress?.(Math.min(1, Math.max(0, progress)));
    };
    restartStall();
    screen.wanted = true;
    state.converting = true;
    void keepAwake();
    await conversion.execute();

    const buffer = target.buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    const result = new Blob([buffer], { type: "video/mp4" });
    // An H.264 clip that came out no smaller gains nothing. Anything else is
    // kept even then, because playing everywhere is worth a few megabytes.
    if (clip.codec === "avc" && result.size >= file.size) return null;

    // Read back before it replaces the original: never a clip shorter than
    // the one filmed, or one that lost its sound.
    const check = new mediabunny.Input({ source: new mediabunny.BlobSource(result), formats: mediabunny.ALL_FORMATS });
    try {
      const copy = {
        seconds: await check.computeDuration(),
        picture: (await check.getPrimaryVideoTrack()) !== null,
        sound: (await check.getPrimaryAudioTrack()) !== null,
      };
      if (!isWholeClip(copy, { seconds: duration, sound: audio !== null })) return null;
    } finally {
      check.dispose();
    }
    return { file: result, capturedAt };
  } catch {
    if (interrupted) throw new ConversionInterrupted();
    return null;
  } finally {
    if (stall) clearTimeout(stall);
    document.removeEventListener("visibilitychange", onVisibility);
    screen.wanted = false;
    void screen.lock?.release().catch(() => {});
    input?.dispose();
  }
}
