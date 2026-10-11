import { describe, expect, it } from "vitest";
import { REEL, coverRect, detectTempo, frameAt, kenBurns, planReel } from "./reel";

/** Clicks on every beat over silence, which any tempo finder should read. */
function clickTrack(bpm: number, seconds: number, sampleRate = 22050, offset = 0.2): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const beat = 60 / bpm;
  for (let t = offset; t < seconds; t += beat) {
    const start = Math.round(t * sampleRate);
    for (let index = 0; index < 400 && start + index < samples.length; index += 1) samples[start + index] = Math.sin(index / 3) * (1 - index / 400);
  }
  return samples;
}

describe("the music's tempo", () => {
  it("is found in a steady beat, with where the beats fall", () => {
    for (const bpm of [96, 120, 128]) {
      const tempo = detectTempo(clickTrack(bpm, 20), 22050);
      expect(tempo).not.toBeNull();
      expect(Math.abs(tempo!.bpm - bpm)).toBeLessThan(2);
      const beat = 60 / tempo!.bpm;
      const phase = ((tempo!.offset - 0.2) % beat + beat) % beat;
      // Within one video frame, which is as close as a cut can land.
      expect(Math.min(phase, beat - phase)).toBeLessThan(1 / 30);
    }
  });

  it("is nothing for silence, for noise, or for a clip too short to tell", () => {
    expect(detectTempo(new Float32Array(22050 * 10), 22050)).toBeNull();
    const tone = new Float32Array(22050 * 10).map((_, index) => Math.sin(index * 0.12) * 0.3);
    expect(detectTempo(tone, 22050)).toBeNull();
    // mulberry32: real white noise. (A textbook LCG in floating point is
    // periodic, which is a beat.)
    let seed = 7;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const noise = new Float32Array(22050 * 10).map(() => (random() - 0.5) * 0.6);
    expect(detectTempo(noise, 22050)).toBeNull();
    expect(detectTempo(clickTrack(120, 2), 22050)).toBeNull();
  });
});

describe("the reel's timing", () => {
  it("spaces shots evenly without music, inside the length a story holds", () => {
    const plan = planReel(12);
    expect(plan.shots).toHaveLength(12);
    expect(plan.shots[0].start).toBe(REEL.titleSeconds);
    const lengths = plan.shots.map((shot) => shot.end - shot.start);
    expect(new Set(lengths.map((length) => length.toFixed(6))).size).toBe(1);
    expect(lengths[0]).toBeGreaterThanOrEqual(REEL.minShot);
    expect(plan.duration).toBeLessThanOrEqual(REEL.targetSeconds + 0.01);
  });

  it("cuts on the beat with music, every shot a whole number of beats", () => {
    const tempo = { bpm: 120, offset: 0.3 };
    const plan = planReel(10, tempo);
    const beat = 0.5;
    for (const shot of plan.shots) {
      const fromOffset = (shot.start - tempo.offset) / beat;
      expect(Math.abs(fromOffset - Math.round(fromOffset))).toBeLessThan(1e-9);
      expect(shot.end - shot.start).toBeGreaterThanOrEqual(REEL.minShot);
      expect(shot.end - shot.start).toBeLessThanOrEqual(REEL.maxShot);
    }
    expect(plan.shots[0].start).toBeGreaterThanOrEqual(REEL.titleSeconds);
  });

  it("uses at most twelve photos, and stretches a few to stay watchable", () => {
    expect(planReel(40).shots).toHaveLength(REEL.maxPhotos);
    const few = planReel(3);
    expect(few.shots[0].end - few.shots[0].start).toBe(REEL.maxShot);
  });
});

describe("each frame", () => {
  const plan = planReel(4);

  it("is the title, then shots with a crossfade into the next, then the end card", () => {
    expect(frameAt(plan, 0).kind).toBe("title");
    const middle = frameAt(plan, plan.shots[1].start + 0.1);
    expect(middle).toMatchObject({ kind: "shot", shot: plan.shots[1] });
    const fading = frameAt(plan, plan.shots[1].end - REEL.crossfade / 2);
    expect(fading.kind === "shot" && fading.next?.mix).toBeCloseTo(0.5);
    const end = frameAt(plan, plan.endStart + 0.1);
    expect(end.kind).toBe("end");
    expect(end.kind === "end" && end.fromShot?.shot).toBe(plan.shots[3]);
  });
});

describe("the slow move", () => {
  it("pushes in on one shot and out on the next, staying small", () => {
    expect(kenBurns(0, 0).scale).toBeCloseTo(1);
    expect(kenBurns(0, 1).scale).toBeCloseTo(1.08);
    expect(kenBurns(1, 0).scale).toBeCloseTo(1.08);
    expect(kenBurns(1, 1).scale).toBeCloseTo(1);
    for (const t of [0, 0.5, 1]) expect(Math.abs(kenBurns(2, t).y)).toBeLessThanOrEqual(0.015);
  });

  it("always covers the frame, landscape or portrait", () => {
    for (const [w, h] of [
      [4000, 3000],
      [1080, 1920],
      [3000, 3000],
    ]) {
      const rect = coverRect(w, h, 1080, 1920, { scale: 1, x: 0, y: 0 });
      expect(rect.x).toBeLessThanOrEqual(0);
      expect(rect.y).toBeLessThanOrEqual(0);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(1080 - 1e-6);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(1920 - 1e-6);
    }
  });
});
