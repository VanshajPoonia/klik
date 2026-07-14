import type { CSSProperties } from "react";

type Frame = {
  id: string;
  left: number;
  top: number;
  width: number;
  rotate: number;
  delay: number;
  aspect: string;
  look: string;
  tag?: string;
  live?: boolean;
};

const frames: Frame[] = [
  {
    id: "a",
    left: 1,
    top: 10,
    width: 27,
    rotate: -9,
    delay: 0,
    aspect: "4 / 5",
    look: "radial-gradient(circle at 25% 25%, rgba(237,238,0,0.5), transparent 42%), radial-gradient(circle at 75% 65%, rgba(243,241,233,0.18), transparent 38%), linear-gradient(160deg, #1c1c12, #050505)",
    tag: "MAYA · 9:42 PM",
  },
  {
    id: "b",
    left: 32,
    top: 0,
    width: 24,
    rotate: 6,
    delay: 90,
    aspect: "1 / 1",
    look: "radial-gradient(circle at 70% 30%, rgba(243,241,233,0.3), transparent 40%), radial-gradient(circle at 30% 75%, rgba(237,238,0,0.25), transparent 35%), linear-gradient(150deg, #17170f, #050505)",
  },
  {
    id: "c",
    left: 60,
    top: 13,
    width: 30,
    rotate: -4,
    delay: 180,
    aspect: "4 / 5",
    look: "radial-gradient(circle at 30% 30%, rgba(237,238,0,0.4), transparent 45%), radial-gradient(circle at 80% 20%, rgba(243,241,233,0.22), transparent 30%), linear-gradient(165deg, #1a1a12, #050505)",
    live: true,
  },
  {
    id: "d",
    left: 5,
    top: 55,
    width: 22,
    rotate: 7,
    delay: 270,
    aspect: "4 / 5",
    look: "radial-gradient(circle at 60% 70%, rgba(243,241,233,0.2), transparent 40%), radial-gradient(circle at 20% 20%, rgba(237,238,0,0.3), transparent 35%), linear-gradient(155deg, #16160e, #050505)",
  },
  {
    id: "e",
    left: 35,
    top: 50,
    width: 26,
    rotate: -6,
    delay: 360,
    aspect: "1 / 1",
    look: "radial-gradient(circle at 40% 60%, rgba(237,238,0,0.45), transparent 40%), radial-gradient(circle at 80% 30%, rgba(243,241,233,0.2), transparent 35%), linear-gradient(160deg, #1c1c12, #050505)",
    tag: "DEV · 10:03 PM",
  },
  {
    id: "f",
    left: 68,
    top: 54,
    width: 25,
    rotate: 8,
    delay: 450,
    aspect: "4 / 5",
    look: "radial-gradient(circle at 30% 70%, rgba(243,241,233,0.22), transparent 40%), radial-gradient(circle at 75% 25%, rgba(237,238,0,0.3), transparent 35%), linear-gradient(160deg, #18180f, #050505)",
  },
];

export function PhotoStack() {
  return (
    <div
      className="relative h-[380px] w-full sm:h-[440px] lg:h-[520px]"
      role="img"
      aria-label="Photos from a shared event gallery, arriving live as guests upload them"
    >
      {frames.map((f) => (
        <div
          key={f.id}
          className="klik-frame absolute overflow-hidden rounded-[28px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] ring-1 ring-white/5"
          style={
            {
              left: `${f.left}%`,
              top: `${f.top}%`,
              width: `${f.width}%`,
              aspectRatio: f.aspect,
              transform: `rotate(${f.rotate}deg)`,
              background: f.look,
              "--delay": `${f.delay}ms`,
              "--tilt": `${f.rotate}deg`,
            } as CSSProperties
          }
        >
          {f.tag && (
            <span className="absolute bottom-3 left-3 hidden whitespace-nowrap rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper/90 backdrop-blur-sm sm:inline-block">
              {f.tag}
            </span>
          )}
          {f.live && (
            <span className="absolute right-3 top-3 hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-black/50 py-1 pl-1.5 pr-2.5 backdrop-blur-sm sm:flex">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt opacity-75" />
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
