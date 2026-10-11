/**
 * GRW-2: the highlight reel's timing and motion, kept pure so it is tested
 * without a browser. The drawing and encoding are in
 * `components/dashboard/reel-maker.tsx`.
 *
 * A reel is a title card, a shot per highlight with a slow push in or out,
 * a short crossfade between shots, and an end card. With music, every cut
 * lands on a beat; without, shots are evenly spaced.
 */

export const REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
  titleSeconds: 2.5,
  endSeconds: 2.5,
  /** About what a story holds. */
  targetSeconds: 30,
  maxPhotos: 12,
  minPhotos: 3,
  minShot: 1.6,
  maxShot: 3.2,
  crossfade: 0.4,
  /** The music fades over the last this many seconds. */
  fadeOut: 1.5,
} as const;

export interface Tempo {
  bpm: number;
  /** Seconds to the first beat. */
  offset: number;
}

/**
 * The music's tempo, from where its loudness rises. Plain onset
 * autocorrelation: good enough to cut on the beat of pop and dance music,
 * which is what people choose for a party reel, and null when nothing
 * repeats clearly (speech, ambient), in which case shots are evenly spaced.
 */
export function detectTempo(samples: Float32Array, sampleRate: number): Tempo | null {
  const hop = Math.max(1, Math.round(sampleRate / 100)); // 10 ms frames
  const frames = Math.floor(samples.length / hop);
  if (frames < 400) return null; // under four seconds
  const energy = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let index = frame * hop; index < (frame + 1) * hop; index += 1) sum += samples[index] * samples[index];
    energy[frame] = Math.sqrt(sum / hop);
  }
  // Onset strength: how much louder each frame is than the last.
  const onset = new Float32Array(frames);
  for (let frame = 1; frame < frames; frame += 1) onset[frame] = Math.max(0, energy[frame] - energy[frame - 1]);
  const mean = onset.reduce((total, value) => total + value, 0) / frames;
  const loudness = energy.reduce((total, value) => total + value, 0) / frames;
  // A steady sound (a held note, hiss) barely changes from frame to frame,
  // and has no beat to cut on however its tiny wobbles line up.
  if (mean === 0 || mean < loudness * 0.02) return null;

  const frameRate = sampleRate / hop;
  // Normalised autocorrelation of the onsets around their mean: near 1 at
  // the beat of a steady rhythm, near 0 at every lag of noise.
  const centered = onset.map((value) => value - mean);
  const variance = centered.reduce((total, value) => total + value * value, 0) / frames;
  if (variance === 0) return null;
  const correlate = (lag: number) => {
    let score = 0;
    for (let frame = lag; frame < frames; frame += 1) score += centered[frame] * centered[frame - lag];
    return score / (frames - lag) / variance;
  };
  const minLag = Math.round((frameRate * 60) / 180);
  const maxLag = Math.round((frameRate * 60) / 70);
  const scores = new Map<number, number>();
  let best = { lag: 0, score: 0 };
  let total = 0;
  // 70 to 180 beats a minute.
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = correlate(lag);
    scores.set(lag, score);
    total += score;
    if (score > best.score) best = { lag, score };
  }
  // A beat repeats clearly, or there is none to cut on.
  void total;
  if (best.lag === 0 || best.score < 0.2) return null;

  // The beat between whole frames, and where it falls, found together: a
  // comb of beats laid over the onsets at fractional lags and phases, keeping
  // the one that collects the most. A tempo off by a fraction of a percent
  // would otherwise drift a cut off the beat by the end of a song.
  const at = (position: number) => {
    const low = Math.floor(position);
    const weight = position - low;
    return (onset[low] ?? 0) * (1 - weight) + (onset[low + 1] ?? 0) * weight;
  };
  let comb = { lag: best.lag, start: 0, score: -1 };
  for (let lag = best.lag - 1; lag <= best.lag + 1; lag += 0.02) {
    for (let start = 0; start < lag; start += 0.25) {
      let score = 0;
      for (let position = start; position < frames - 1; position += lag) score += at(position);
      if (score > comb.score) comb = { lag, start, score };
    }
  }
  return { bpm: (frameRate * 60) / comb.lag, offset: comb.start / frameRate };
}

export interface Shot {
  /** Index into the photos. */
  photo: number;
  start: number;
  end: number;
}

export interface ReelPlan {
  shots: Shot[];
  /** When the end card starts. */
  endStart: number;
  duration: number;
}

/**
 * When each photo is on screen. Each shot is the same length: with a tempo,
 * the whole number of beats nearest an even share of the time (and between
 * `minShot` and `maxShot`), cut on the beat; without, an even share.
 */
export function planReel(photoCount: number, tempo: Tempo | null = null): ReelPlan {
  const count = Math.max(0, Math.min(REEL.maxPhotos, photoCount));
  const available = REEL.targetSeconds - REEL.titleSeconds - REEL.endSeconds;
  const even = count > 0 ? Math.min(REEL.maxShot, Math.max(REEL.minShot, available / count)) : 0;
  let shot = even;
  let firstCut = REEL.titleSeconds;
  if (tempo && count > 0) {
    const beat = 60 / tempo.bpm;
    const beats = Math.max(1, Math.round(even / beat));
    const candidates = [beats - 1, beats, beats + 1].filter((n) => n >= 1 && n * beat >= REEL.minShot && n * beat <= REEL.maxShot);
    const chosen = candidates.sort((a, b) => Math.abs(a * beat - even) - Math.abs(b * beat - even))[0];
    if (chosen) {
      shot = chosen * beat;
      // The first cut is the first beat after the title has been read.
      const after = Math.max(0, REEL.titleSeconds - tempo.offset);
      firstCut = tempo.offset + Math.ceil(after / beat) * beat;
    }
  }
  const shots: Shot[] = [];
  for (let index = 0; index < count; index += 1) {
    shots.push({ photo: index, start: firstCut + index * shot, end: firstCut + (index + 1) * shot });
  }
  const endStart = count > 0 ? shots[count - 1].end : REEL.titleSeconds;
  return { shots, endStart, duration: endStart + REEL.endSeconds };
}

/**
 * The slow move on one photo: alternate shots push in and pull out, and
 * drift a little across, so consecutive photos never move the same way.
 * `progress` runs 0 to 1 over the shot.
 */
export function kenBurns(index: number, progress: number): { scale: number; x: number; y: number } {
  const t = Math.min(1, Math.max(0, progress));
  const eased = t * t * (3 - 2 * t);
  const zoomIn = index % 2 === 0;
  const scale = zoomIn ? 1 + 0.08 * eased : 1.08 - 0.08 * eased;
  const direction = [
    [1, 0],
    [-1, 0.5],
    [0, 1],
    [0.5, -1],
  ][index % 4];
  return { scale, x: direction[0] * 0.03 * (eased - 0.5), y: direction[1] * 0.03 * (eased - 0.5) };
}

/**
 * Where to draw an image so it covers the frame, scaled and offset by a
 * Ken Burns move (offsets as a share of the frame).
 */
export function coverRect(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  move: { scale: number; x: number; y: number } = { scale: 1, x: 0, y: 0 },
): { x: number; y: number; width: number; height: number } {
  const cover = Math.max(frameWidth / imageWidth, frameHeight / imageHeight) * move.scale;
  const width = imageWidth * cover;
  const height = imageHeight * cover;
  return {
    x: (frameWidth - width) / 2 + move.x * frameWidth,
    y: (frameHeight - height) / 2 + move.y * frameHeight,
    width,
    height,
  };
}

/** What is on screen at time `t`: the title, one or two shots crossfading, or the end card. */
export type Frame =
  | { kind: "title"; progress: number }
  | { kind: "shot"; shot: Shot; progress: number; next?: { shot: Shot; progress: number; mix: number } }
  | { kind: "end"; progress: number; fromShot?: { shot: Shot; mix: number } };

export function frameAt(plan: ReelPlan, t: number): Frame {
  const first = plan.shots[0];
  if (!first || t < first.start) {
    // The title fades into the first photo over the crossfade.
    return { kind: "title", progress: Math.min(1, t / REEL.titleSeconds) };
  }
  if (t >= plan.endStart) {
    const last = plan.shots[plan.shots.length - 1];
    const into = t - plan.endStart;
    return {
      kind: "end",
      progress: Math.min(1, into / REEL.endSeconds),
      ...(last && into < REEL.crossfade ? { fromShot: { shot: last, mix: 1 - into / REEL.crossfade } } : {}),
    };
  }
  const index = plan.shots.findIndex((shot) => t >= shot.start && t < shot.end);
  const shot = plan.shots[index];
  const length = shot.end - shot.start;
  const progress = (t - shot.start) / length;
  const next = plan.shots[index + 1];
  const left = shot.end - t;
  if (next && left < REEL.crossfade) {
    return {
      kind: "shot",
      shot,
      progress,
      next: { shot: next, progress: 0, mix: 1 - left / REEL.crossfade },
    };
  }
  return { kind: "shot", shot, progress };
}
