import Image from "next/image";
import { Check, Link2, SwitchCamera } from "lucide-react";
import type { CSSProperties } from "react";
import { QrGlyph } from "./qr-glyph";
import { DEMO_URL, MOMENTS } from "./sample-media";

/*
 * The three steps, drawn as what a guest's phone shows at each one. Every
 * looping part carries `vg-run`, which only runs while the frame is on screen
 * (InView); its resting style is the state worth seeing when nothing moves.
 */

/** The camera's code-detected brackets: four rounded corners, nothing between. */
function Brackets({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`overflow-visible ${className}`} aria-hidden="true">
      <path
        d="M1 23V11Q1 1 11 1H23M77 1H89Q99 1 99 11V23M99 77V89Q99 99 89 99H77M23 99H11Q1 99 1 89V77"
        fill="none"
        className="stroke-volt"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ScanVignette() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <Image
        src={MOMENTS.wedding.still}
        alt=""
        fill
        sizes="(max-width: 768px) 82vw, 360px"
        className="scale-110 object-cover opacity-60 blur-[3px]"
      />
      <div className="absolute inset-0 bg-canvas/40" />
      <div className="absolute left-1/2 top-[44%] w-[30%] -translate-x-1/2 -translate-y-1/2 -rotate-3 rounded-[6px] bg-paper p-[4%] shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
        <QrGlyph value={DEMO_URL} className="block w-full" />
        <p className="mt-[6%] text-center font-display text-[clamp(9px,1vw,12px)] leading-none text-canvas">
          Scan to share
        </p>
      </div>
      <Brackets className="absolute left-1/2 top-[44%] aspect-square h-[70%] -translate-x-1/2 -translate-y-1/2" />
      <span
        className="vg-run absolute bottom-[8%] left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-volt px-3 py-1.5 text-[11px] font-medium text-on-volt shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        style={{ animation: "vg-pop 3.6s cubic-bezier(0.16, 1, 0.3, 1) infinite" }}
      >
        <Link2 className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
        Open the gallery
      </span>
    </div>
  );
}

export function SnapVignette() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <Image
        src={MOMENTS.birthday.still}
        alt=""
        fill
        sizes="(max-width: 768px) 82vw, 360px"
        className="object-cover"
        style={{ objectPosition: "62% 40%" }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-[14%] bg-gradient-to-t from-canvas/85 via-canvas/40 to-transparent pb-[4%] pt-[12%]">
        <span className="relative block aspect-square w-[11%] overflow-hidden rounded-[5px] ring-1 ring-paper/40">
          <Image
            src={MOMENTS.birthday.still}
            alt=""
            fill
            sizes="48px"
            className="vg-run object-cover"
            style={
              {
                objectPosition: "72% 45%",
                animation: "vg-pop 3.2s cubic-bezier(0.16, 1, 0.3, 1) 1.45s infinite",
              } as CSSProperties
            }
          />
        </span>
        <span
          className="vg-run flex aspect-square w-[15%] items-center justify-center rounded-full border-[3px] border-paper"
          style={{ animation: "vg-press 3.2s ease-out 0.9s infinite" }}
        >
          <span className="block h-[78%] w-[78%] rounded-full bg-paper" />
        </span>
        <SwitchCamera className="w-[8%] text-paper/90" strokeWidth={1.75} aria-hidden="true" />
      </div>
      {/* The flash. Resting state is off, so with reduced motion nothing blinks. */}
      <div
        className="vg-run absolute inset-0 bg-paper opacity-0"
        style={{ animation: "vg-flash 3.2s linear infinite" }}
      />
    </div>
  );
}

const ALBUM: Array<{ src: string; position: string }> = [
  { src: MOMENTS.wedding.still, position: "30% 40%" },
  { src: MOMENTS.graduation.still, position: "55% 30%" },
  { src: MOMENTS.reunion.still, position: "60% 50%" },
  { src: MOMENTS.shower.still, position: "45% 35%" },
  { src: MOMENTS.company.still, position: "25% 50%" },
];

export function LandVignette() {
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-2 gap-[3px] bg-canvas p-[3px]">
      <div className="relative overflow-hidden rounded-[3px]">
        <div
          className="vg-run absolute inset-0 overflow-hidden rounded-[3px] ring-2 ring-inset ring-volt"
          style={{ animation: "vg-drop 4s cubic-bezier(0.16, 1, 0.3, 1) infinite" }}
        >
          <Image
            src={MOMENTS.birthday.still}
            alt=""
            fill
            sizes="120px"
            className="object-cover"
            style={{ objectPosition: "72% 45%" }}
          />
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-volt py-0.5 pl-1 pr-1.5 text-[9px] font-semibold text-on-volt">
            <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
            New
          </span>
        </div>
      </div>
      {ALBUM.map((photo) => (
        <div key={photo.src} className="relative overflow-hidden rounded-[3px]">
          <Image
            src={photo.src}
            alt=""
            fill
            sizes="120px"
            className="object-cover"
            style={{ objectPosition: photo.position }}
          />
        </div>
      ))}
    </div>
  );
}
