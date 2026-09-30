import Image from "next/image";
import type { CSSProperties } from "react";

type Frame = {
  id: string;
  src: string;
  left: number;
  top: number;
  width: number;
  /** Placement below the sm breakpoint, where the stack is a tighter two-column pile. */
  small: { left: number; top: number; width: number };
  rotate: number;
  delay: number;
  aspect: string;
  position?: string;
  tag?: string;
  live?: boolean;
  preload?: boolean;
};

const frames: Frame[] = [
  {
    id: "birthday",
    src: "/images/sample-events/birthday-party.png",
    left: 0,
    top: 8,
    width: 32,
    small: { left: 0, top: 2, width: 47 },
    rotate: -5,
    delay: 0,
    aspect: "4 / 3",
    tag: "BIRTHDAY · JUST NOW",
  },
  {
    id: "wedding",
    src: "/images/sample-events/wedding-reception.png",
    left: 34,
    top: 0,
    width: 31,
    small: { left: 53, top: 5, width: 47 },
    rotate: 3,
    delay: 90,
    aspect: "16 / 10",
    preload: true,
  },
  {
    id: "company",
    src: "/images/sample-events/company-party.png",
    left: 67,
    top: 9,
    width: 33,
    small: { left: 52, top: 38, width: 47 },
    rotate: -3,
    delay: 180,
    aspect: "4 / 3",
    live: true,
  },
  {
    id: "family",
    src: "/images/sample-events/family-reunion.png",
    left: 2,
    top: 54,
    width: 31,
    small: { left: 2, top: 34, width: 46 },
    rotate: 4,
    delay: 270,
    aspect: "16 / 10",
    position: "center 45%",
  },
  {
    id: "baby-shower",
    src: "/images/sample-events/baby-shower.png",
    left: 34,
    top: 48,
    width: 34,
    small: { left: 0, top: 66, width: 47 },
    rotate: -4,
    delay: 360,
    aspect: "4 / 3",
    tag: "BABY SHOWER · 2M AGO",
  },
  {
    id: "graduation",
    src: "/images/sample-events/graduation.png",
    left: 70,
    top: 53,
    width: 30,
    small: { left: 53, top: 70, width: 46 },
    rotate: 5,
    delay: 450,
    aspect: "16 / 10",
  },
];

export function PhotoStack() {
  return (
    <div
      className="relative h-[380px] w-full sm:h-[390px] lg:h-[520px]"
      role="img"
      aria-label="Sample photos from birthday, wedding, company, family, baby shower, and graduation galleries"
    >
      {frames.map((f) => (
        <div
          key={f.id}
          className="klik-frame absolute left-[var(--sl)] top-[var(--st)] w-[var(--sw)] overflow-hidden rounded-[18px] bg-canvas-raised shadow-[3px_5px_30px_rgba(0,0,0,0.22)] ring-1 ring-white/10 sm:left-[var(--l)] sm:top-[var(--t)] sm:w-[var(--w)]"
          style={
            {
              "--l": `${f.left}%`,
              "--t": `${f.top}%`,
              "--w": `${f.width}%`,
              "--sl": `${f.small.left}%`,
              "--st": `${f.small.top}%`,
              "--sw": `${f.small.width}%`,
              aspectRatio: f.aspect,
              transform: `rotate(${f.rotate}deg)`,
              "--delay": `${f.delay}ms`,
              "--tilt": `${f.rotate}deg`,
            } as CSSProperties
          }
        >
          <Image
            src={f.src}
            alt=""
            fill
            preload={f.preload}
            sizes="(max-width: 640px) 47vw, (max-width: 1024px) 31vw, 360px"
            className="object-cover"
            style={{ objectPosition: f.position ?? "center" }}
          />
          {f.tag && (
            <span className="absolute bottom-3 left-3 z-10 hidden whitespace-nowrap rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper/90 backdrop-blur-sm sm:inline-block">
              {f.tag}
            </span>
          )}
          {f.live && (
            <span className="absolute right-3 top-3 z-10 hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-black/60 py-1 pl-1.5 pr-2.5 backdrop-blur-sm sm:flex">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
              </span>
              <span className="font-mono text-[10px] tracking-wide text-paper/90">Just added</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
