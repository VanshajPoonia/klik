"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { EdgeArrow } from "./film-cell";
import { GreaseMark } from "./grease-mark";
import { LOOP_SECONDS, MOMENTS, type Moment } from "./sample-media";

type ReelFrame = {
  moment: Moment;
  kind: "still" | "loop";
  /** Frame number in edge print. A loop is the half frame after its still. */
  n: string;
  position?: string;
  keeper?: boolean;
  live?: boolean;
};

/**
 * Consecutive frames of the same moment, a still and then a loop on a tighter
 * crop, the way a real roll holds a burst of the same scene.
 */
const FRAMES: ReelFrame[] = [
  { moment: MOMENTS.wedding, kind: "still", n: "12", position: "center 35%" },
  { moment: MOMENTS.wedding, kind: "loop", n: "12A" },
  { moment: MOMENTS.birthday, kind: "still", n: "13", position: "60% 40%", keeper: true },
  { moment: MOMENTS.birthday, kind: "loop", n: "13A" },
  { moment: MOMENTS.company, kind: "still", n: "14", live: true },
  { moment: MOMENTS.company, kind: "loop", n: "14A" },
  { moment: MOMENTS.reunion, kind: "still", n: "15", position: "center 45%" },
  { moment: MOMENTS.reunion, kind: "loop", n: "15A" },
  { moment: MOMENTS.shower, kind: "still", n: "16", position: "center 30%" },
  { moment: MOMENTS.shower, kind: "loop", n: "16A" },
  { moment: MOMENTS.graduation, kind: "still", n: "17", position: "center 30%" },
  { moment: MOMENTS.graduation, kind: "loop", n: "17A" },
];

const STEP = 360 / FRAMES.length;
/** Where the reel rests on first paint: the circled keeper just left of centre. */
const START = -2.6 * STEP;
/** Degrees per second while nobody is touching it. Negative brings new frames in from the right. */
const DRIFT = -2.2;
const DEG_PER_PX = 0.16;
/** A loop plays while it faces the viewer within this many degrees. */
const PLAY_WITHIN = 70;

function ringTransform(spin: number) {
  return `translateZ(calc(var(--r) * -1)) rotateX(-7deg) rotateY(${spin.toFixed(3)}deg)`;
}

/**
 * The hero's reel of frames on a cylinder, in real CSS 3D. It drifts on its
 * own, spins when dragged, and only the loops facing the viewer play. With
 * reduced motion it stands still and plays nothing, but can still be dragged,
 * since that motion is the visitor's own.
 */
export function FilmReel() {
  const stageRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const ring = ringRef.current;
    if (!stage || !ring) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let spin = START;
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let visible = true;
    let frame = 0;
    let previous = performance.now();
    const playing = new Set<number>();
    // See LoopVideo: hydration leaves `muted` unset, and autoplay needs it.
    videoRefs.current.forEach((video) => {
      if (video) video.muted = true;
    });

    const syncVideos = () => {
      videoRefs.current.forEach((video, index) => {
        if (!video) return;
        const angle = ((((index * STEP + spin) % 360) + 540) % 360) - 180;
        const shouldPlay = visible && !reduce.matches && Math.abs(angle) < PLAY_WITHIN;
        if (shouldPlay && !playing.has(index)) {
          playing.add(index);
          video.play().catch(() => playing.delete(index));
        } else if (!shouldPlay && playing.has(index)) {
          playing.delete(index);
          video.pause();
        }
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (visible && !dragging) {
        const target = reduce.matches ? 0 : DRIFT;
        // Ease any fling back toward the resting drift over about a second.
        velocity += (target - velocity) * (1 - Math.exp(-dt / 0.9));
        spin += velocity * dt;
        ring.style.transform = ringTransform(spin);
      }
      syncVideos();
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(stage);

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      lastT = event.timeStamp;
      velocity = 0;
      stage.setPointerCapture(event.pointerId);
      stage.dataset.dragging = "true";
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dt = Math.max(1, event.timeStamp - lastT) / 1000;
      spin += dx * DEG_PER_PX;
      velocity = velocity * 0.6 + ((dx * DEG_PER_PX) / dt) * 0.4;
      lastX = event.clientX;
      lastT = event.timeStamp;
      ring.style.transform = ringTransform(spin);
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (reduce.matches) velocity = 0;
      stage.dataset.dragging = "false";
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      role="img"
      aria-label="A reel of sample photos and short videos from a wedding, a birthday, a company party, a reunion, a baby shower and a graduation"
      data-dragging="false"
      className="relative mx-auto h-[calc(var(--h)*1.16)] w-full cursor-grab touch-pan-y select-none [--w:216px] [perspective-origin:50%_45%] [perspective:calc(var(--r)*2.5)] data-[dragging=true]:cursor-grabbing sm:[--w:272px] lg:[--w:328px]"
      style={
        {
          "--r": "calc((var(--w) + 1px) * 1.9319)",
          "--h": "calc(var(--w) * 2 / 3 + 58px)",
        } as CSSProperties
      }
    >
      <div
        ref={ringRef}
        className="absolute inset-0 [transform-style:preserve-3d]"
        style={{ transform: ringTransform(START) }}
      >
        {FRAMES.map((frame, index) => (
          <div
            key={frame.n}
            aria-hidden="true"
            className="film absolute left-1/2 top-1/2 ml-[calc(var(--w)/-2)] mt-[calc(var(--h)/-2)] flex w-[var(--w)] flex-col [backface-visibility:hidden]"
            style={{ transform: `rotateY(${index * STEP}deg) translateZ(var(--r))` }}
          >
            <div className="sprockets" />
            <div className="relative px-[7px]">
              <div
                className="klik-frame relative aspect-[3/2] overflow-hidden rounded-[2px] bg-canvas-raised"
                style={{ "--delay": `${200 + (index % 6) * 90}ms` } as CSSProperties}
              >
                {frame.kind === "still" ? (
                  <Image
                    src={frame.moment.still}
                    alt=""
                    fill
                    draggable={false}
                    preload={index === 2}
                    sizes="(max-width: 640px) 216px, (max-width: 1024px) 272px, 328px"
                    className="object-cover"
                    style={{ objectPosition: frame.position ?? "center" }}
                  />
                ) : (
                  <>
                    <video
                      ref={(element) => {
                        videoRefs.current[index] = element;
                      }}
                      className="absolute inset-0 h-full w-full object-cover"
                      src={frame.moment.loop}
                      poster={frame.moment.poster}
                      muted
                      loop
                      playsInline
                      preload="none"
                      disablePictureInPicture
                      disableRemotePlayback
                      tabIndex={-1}
                    />
                    <span className="absolute bottom-2 right-2 rounded-[4px] bg-canvas/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-paper/90 backdrop-blur-sm">
                      0:{String(LOOP_SECONDS).padStart(2, "0")}
                    </span>
                  </>
                )}
                {frame.live && (
                  <span className="absolute right-2 top-2 z-10 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-canvas/70 py-1 pl-1.5 pr-2.5 backdrop-blur-sm">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
                    </span>
                    <span className="font-mono text-[10px] tracking-wide text-paper/90">Just added</span>
                  </span>
                )}
              </div>
              {frame.keeper && <GreaseMark className="-inset-x-1 -inset-y-3 z-10" delay="1.1s" />}
            </div>
            <div className="edge-print flex items-center justify-between px-2.5 pt-2">
              <span className="flex items-center gap-1.5">
                <EdgeArrow />
                {frame.n}
              </span>
              <span>Klik 400</span>
            </div>
            <div className="sprockets" />
          </div>
        ))}
      </div>
    </div>
  );
}
