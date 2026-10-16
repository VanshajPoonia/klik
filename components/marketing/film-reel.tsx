"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { EdgeArrow } from "./film-cell";
import { GreaseMark } from "./grease-mark";
import { LOOP_SECONDS, MOMENTS, type Moment } from "./sample-media";

type ReelFrame = {
  moment: Moment;
  kind: "still" | "loop";
  /** Frame number in edge print. */
  n: string;
  position?: string;
  keeper?: boolean;
  live?: boolean;
};

/**
 * Stills and loops alternate, and each moment's loop sits five frames on from
 * its still, so the frames facing the viewer are always different scenes and
 * one of them is always moving.
 */
const FRAMES: ReelFrame[] = [
  { moment: MOMENTS.wedding, kind: "still", n: "12", position: "center 35%" },
  { moment: MOMENTS.shower, kind: "loop", n: "13" },
  { moment: MOMENTS.birthday, kind: "still", n: "14", position: "60% 40%", keeper: true },
  { moment: MOMENTS.graduation, kind: "loop", n: "15" },
  { moment: MOMENTS.company, kind: "still", n: "16", live: true },
  { moment: MOMENTS.wedding, kind: "loop", n: "17" },
  { moment: MOMENTS.reunion, kind: "still", n: "18", position: "center 45%" },
  { moment: MOMENTS.birthday, kind: "loop", n: "19" },
  { moment: MOMENTS.shower, kind: "still", n: "20", position: "center 30%" },
  { moment: MOMENTS.company, kind: "loop", n: "21" },
  { moment: MOMENTS.graduation, kind: "still", n: "22", position: "center 30%" },
  { moment: MOMENTS.reunion, kind: "loop", n: "23" },
];

const STEP = 360 / FRAMES.length;
/**
 * Distance from the axis to the middle of each flat frame, as a multiple of
 * its width: 1 / (2 tan(180° / 12)). Frames this far out meet edge to edge, so
 * the reel reads as one unbroken strip.
 */
const APOTHEM = 1 / (2 * Math.tan(Math.PI / FRAMES.length));
/** Where the reel rests on first paint: the circled keeper just left of centre. */
const START = -2.6 * STEP;
/** Degrees per second while nobody is touching it. Negative brings new frames in from the right. */
const DRIFT = -2.2;
/** The drift slows to this share while a mouse rests on the reel, so a frame can be looked at. */
const HOVER_DRIFT = 0.3;
/** Frames within this many degrees of the viewer are fully lit... */
const SHADE_FROM = 15;
/** ...and have all but gone into the canvas by this many. */
const SHADE_TO = 95;
/** A loop plays while it faces the viewer within this many degrees. */
const PLAY_WITHIN = 70;

function ringTransform(spin: number) {
  return `translateZ(calc(var(--r) * -1)) rotateX(-7deg) rotateY(${spin.toFixed(3)}deg)`;
}

/** Where a frame faces, from -180 to 180 degrees, 0 being straight at the viewer. */
function facing(index: number, spin: number) {
  return ((((index * STEP + spin) % 360) + 540) % 360) - 180;
}

/**
 * How far a frame has turned out of the light. Frames facing the viewer are
 * lit, and frames rounding the drum fall into the canvas until they vanish
 * at its edge, which is what makes the reel read as a solid cylinder.
 */
function shade(angle: number) {
  const t = Math.min(1, Math.max(0, (Math.abs(angle) - SHADE_FROM) / (SHADE_TO - SHADE_FROM)));
  return 0.94 * t * t * (3 - 2 * t);
}

/**
 * The hero's reel of frames on a cylinder, in real CSS 3D. It drifts on its
 * own and spins when dragged or swiped sideways on a trackpad; the frame under
 * the pointer stays under it. Only the loops facing the viewer play. With
 * reduced motion it stands still and plays nothing, but can still be dragged,
 * since that motion is the visitor's own.
 */
export function FilmReel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const shadeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const ring = ringRef.current;
    if (!root || !stage || !ring) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let spin = START;
    let drawn = Number.NaN;
    let velocity = 0;
    let dragging = false;
    let hovering = false;
    let lastX = 0;
    let lastT = 0;
    let visible = true;
    let frame = 0;
    let previous = performance.now();
    const playing = new Set<number>();
    const shades = FRAMES.map((_, index) => shade(facing(index, START)));
    // See LoopVideo: hydration leaves `muted` unset, and autoplay needs it.
    videoRefs.current.forEach((video) => {
      if (video) video.muted = true;
    });

    /** Degrees per pixel at which the front of the drum keeps pace with the pointer. */
    const degPerPx = () => {
      const width = ring.firstElementChild instanceof HTMLElement ? ring.firstElementChild.offsetWidth : 216;
      return 180 / (Math.PI * (width - 1) * APOTHEM);
    };

    const render = () => {
      if (spin === drawn) return;
      drawn = spin;
      ring.style.transform = ringTransform(spin);
      FRAMES.forEach((_, index) => {
        const angle = facing(index, spin);
        const overlay = shadeRefs.current[index];
        const next = shade(angle);
        if (overlay && Math.abs(next - shades[index]) > 0.004) {
          shades[index] = next;
          overlay.style.opacity = next.toFixed(3);
        }
        const video = videoRefs.current[index];
        if (!video) return;
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
        const target = reduce.matches ? 0 : DRIFT * (hovering ? HOVER_DRIFT : 1);
        // Ease any fling back toward the resting drift over about a second.
        velocity += (target - velocity) * (1 - Math.exp(-dt / 0.9));
        spin += velocity * dt;
      }
      render();
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      // Leaving the viewport pauses every loop; coming back replays the facing ones.
      drawn = Number.NaN;
    });
    observer.observe(stage);

    const spun = () => {
      root.dataset.spun = "true";
    };

    let scale = degPerPx();
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragging = true;
      scale = degPerPx();
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
      spin += dx * scale;
      velocity = velocity * 0.6 + ((dx * scale) / dt) * 0.4;
      lastX = event.clientX;
      lastT = event.timeStamp;
      if (Math.abs(dx) > 0) spun();
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (reduce.matches) velocity = 0;
      stage.dataset.dragging = "false";
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") hovering = true;
    };
    const onLeave = () => {
      hovering = false;
    };
    // A sideways two-finger swipe on a trackpad turns the reel; vertical
    // scrolling is left to the page.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      spin -= event.deltaX * degPerPx();
      velocity = 0;
      spun();
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("wheel", onWheel, { passive: false });
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    // Frame widths are whole multiples of the 24px sprocket pitch, so the holes
    // run on unbroken from one frame to the next.
    <div ref={rootRef} data-spun="false" className="group/reel [--w:216px] sm:[--w:264px] lg:[--w:336px]">
      <div
        ref={stageRef}
        role="img"
        aria-label="A reel of sample photos and short videos from a wedding, a birthday, a company party, a reunion, a baby shower and a graduation"
        data-dragging="false"
        className="relative mx-auto h-[calc(var(--h)*1.16)] w-full cursor-grab touch-pan-y select-none [perspective-origin:50%_45%] [perspective:calc(var(--r)*2.5)] data-[dragging=true]:cursor-grabbing"
        style={
          {
            "--r": `calc((var(--w) - 1px) * ${APOTHEM.toFixed(5)})`,
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
                      sizes="(max-width: 640px) 216px, (max-width: 1024px) 264px, 336px"
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
              {/* The drum's own shadow. Atmosphere, so it goes when contrast is asked for. */}
              <div
                ref={(element) => {
                  shadeRefs.current[index] = element;
                }}
                className="pointer-events-none absolute -inset-px z-20 bg-canvas contrast-more:hidden forced-colors:hidden"
                style={{ opacity: shade(facing(index, START)).toFixed(3) }}
              />
            </div>
          ))}
        </div>
      </div>
      <p
        aria-hidden="true"
        className="mt-[calc(var(--w)*0.12+14px)] flex items-center justify-center gap-2 font-mono text-[10px] uppercase leading-none tracking-[0.16em] text-muted transition-opacity duration-700 group-data-[spun=true]/reel:opacity-0"
      >
        <EdgeArrow className="rotate-180" />
        Spin the reel
        <EdgeArrow />
      </p>
    </div>
  );
}
