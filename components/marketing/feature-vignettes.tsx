import Image from "next/image";
import {
  Check,
  Copy,
  Download,
  EyeOff,
  FileArchive,
  Globe,
  KeyRound,
  Lock,
  QrCode,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { QrGlyph } from "./qr-glyph";
import { DEMO_URL, MOMENTS } from "./sample-media";

/*
 * One frame per host control, each showing the dashboard doing that job.
 * Loops carry `vg-run` (on screen only, off with reduced motion); every
 * resting style is the state that explains the feature without motion.
 */

function Thumb({ src, position, className = "", style }: { src: string; position?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-[4px] bg-canvas-raised ${className}`} style={style}>
      <Image src={src} alt="" fill sizes="140px" className="object-cover" style={{ objectPosition: position ?? "center" }} />
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-canvas-line bg-canvas/85 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-md ${className}`}>
      {children}
    </div>
  );
}

const loop = (name: string, seconds: number, delay = 0, easing = "cubic-bezier(0.16, 1, 0.3, 1)") =>
  ({ animation: `${name} ${seconds}s ${easing} ${delay}s infinite` }) as CSSProperties;

export function QrLinkVignette() {
  return (
    <div className="relative flex h-full w-full items-center gap-[6%] overflow-hidden bg-canvas-raised px-[7%]">
      <div className="relative w-[36%] shrink-0 -rotate-2 rounded-[6px] bg-paper p-[4%] shadow-[0_14px_30px_rgba(0,0,0,0.5)]">
        <QrGlyph value={DEMO_URL} className="block w-full" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-1.5 rounded-full border border-canvas-line bg-canvas px-2.5 py-1.5">
          <span className="truncate font-mono text-[10px] text-paper/80">klik.kreativvantage.com/e/maya-and-theo</span>
        </div>
        <div className="flex gap-1.5">
          <span className="relative flex items-center gap-1 rounded-full bg-volt px-2.5 py-1 text-[10px] font-semibold text-on-volt">
            <Copy className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
            Copy link
            <span
              className="vg-run absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-paper px-2 py-0.5 text-[9px] font-semibold text-canvas"
              style={loop("vg-pop", 3.4)}
            >
              Copied
            </span>
          </span>
          <span className="flex items-center gap-1 rounded-full border border-canvas-line px-2.5 py-1 text-[10px] text-paper/85">
            <QrCode className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            QR
          </span>
        </div>
      </div>
    </div>
  );
}

export function ModerationVignette() {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-[4%] overflow-hidden bg-canvas-raised px-[6%]">
      <Thumb src={MOMENTS.reunion.still} position="65% 50%" className="aspect-[3/4] w-[24%] opacity-60" />
      <div className="relative w-[34%]">
        <Thumb src={MOMENTS.graduation.still} position="50% 30%" className="aspect-[3/4] w-full ring-2 ring-volt" />
        <span
          className="vg-run absolute left-1.5 top-1.5 rounded-full bg-canvas/80 px-1.5 py-0.5 text-[8px] font-medium text-paper opacity-0 backdrop-blur-sm"
          style={loop("vg-pending", 4.4, 0, "linear")}
        >
          Waiting
        </span>
        <span
          className="vg-run absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-volt text-on-volt"
          style={loop("vg-approve", 4.4)}
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
          <span
            className="vg-run rounded-full bg-volt px-2 py-0.5 text-[9px] font-semibold text-on-volt shadow-[0_6px_14px_rgba(0,0,0,0.4)]"
            style={loop("vg-press", 4.4, 0, "ease-out")}
          >
            Approve
          </span>
          <span className="flex items-center gap-0.5 rounded-full bg-canvas px-2 py-0.5 text-[9px] text-paper/80 ring-1 ring-canvas-line">
            <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
            Hide
          </span>
        </div>
      </div>
      <Thumb src={MOMENTS.shower.still} position="40% 35%" className="aspect-[3/4] w-[24%] opacity-60" />
    </div>
  );
}

const ACCESS = [
  { icon: Globe, label: "Public" },
  { icon: KeyRound, label: "Password" },
  { icon: Lock, label: "Private" },
];

function AccessRow({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`flex ${inverse ? "w-[300%]" : "w-full"}`}>
      {ACCESS.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className={`flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] font-medium ${inverse ? "text-on-volt" : "text-paper/75"}`}
        >
          <Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

export function PrivacyVignette() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-canvas">
      <Image
        src={MOMENTS.company.still}
        alt=""
        fill
        sizes="(max-width: 768px) 82vw, 360px"
        className="scale-110 object-cover opacity-45 blur-[6px]"
      />
      <Panel className="relative w-[80%] p-1">
        <div className="relative">
          <AccessRow />
          {/* The selected segment: a volt window sliding across, carrying its
              own dark copy of the labels so they stay legible on volt. */}
          <div
            className="vg-run absolute inset-y-0 left-0 w-1/3 overflow-hidden rounded-full bg-volt"
            style={loop("vg-segment", 6, 0, "cubic-bezier(0.65, 0, 0.35, 1)")}
          >
            <div className="vg-run" style={loop("vg-segment-inner", 6, 0, "cubic-bezier(0.65, 0, 0.35, 1)")}>
              <AccessRow inverse />
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function DownloadsVignette() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <Image
        src={MOMENTS.graduation.still}
        alt=""
        fill
        sizes="(max-width: 768px) 82vw, 360px"
        className="object-cover"
        style={{ objectPosition: "60% 30%" }}
      />
      <span
        className="vg-run absolute right-[5%] top-[7%] flex h-8 w-8 items-center justify-center rounded-full bg-canvas/75 text-paper backdrop-blur-sm"
        style={loop("vg-show-late", 4, 0, "ease-out")}
      >
        <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <Panel className="absolute inset-x-[6%] bottom-[7%] flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-medium text-paper">Guests can download</span>
        <span
          className="vg-run relative h-[18px] w-8 rounded-full bg-volt"
          style={loop("vg-switch-track", 4, 0, "ease-out")}
        >
          <span
            className="vg-run absolute left-[16px] top-[2px] h-[14px] w-[14px] rounded-full bg-paper shadow"
            style={loop("vg-switch", 4)}
          />
        </span>
      </Panel>
    </div>
  );
}

const CLOSING = [
  { src: MOMENTS.wedding.still, position: "30% 40%" },
  { src: MOMENTS.birthday.still, position: "70% 40%" },
  { src: MOMENTS.reunion.still, position: "55% 50%" },
  { src: MOMENTS.company.still, position: "30% 50%" },
  { src: MOMENTS.shower.still, position: "50% 35%" },
  { src: MOMENTS.graduation.still, position: "50% 30%" },
];

export function ExpirationVignette() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas-raised p-[5%]">
      <div className="vg-run grid h-full grid-cols-3 grid-rows-2 gap-1" style={loop("vg-dim", 5, 0, "ease-in-out")}>
        {CLOSING.map((photo) => (
          <Thumb key={photo.src} src={photo.src} position={photo.position} className="h-full" />
        ))}
      </div>
      <Panel className="absolute left-[8%] top-[10%] flex items-center gap-2 px-2 py-1.5">
        <span className="flex flex-col items-center rounded-[4px] bg-paper px-1.5 py-0.5 leading-none text-canvas">
          <span className="text-[7px] font-semibold uppercase tracking-wider">Nov</span>
          <span className="font-display text-[13px]">14</span>
        </span>
        <span className="text-[10px] leading-tight text-paper/85">Gallery closes</span>
      </Panel>
      <span
        className="vg-run absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-[10px] font-semibold text-canvas opacity-0 shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
        style={loop("vg-show-late", 5, 0, "ease-out")}
      >
        <Lock className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
        Locked
      </span>
    </div>
  );
}

export function ProtectedDownloadsVignette() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas-raised p-[5%]">
      <div className="grid h-full grid-cols-4 grid-rows-2 gap-1 opacity-50">
        {[...CLOSING, CLOSING[0], CLOSING[3]].map((photo, index) => (
          <Thumb key={index} src={photo.src} position={photo.position} className="h-full" />
        ))}
      </div>
      <Panel className="absolute inset-x-[8%] top-1/2 -translate-y-1/2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <FileArchive className="h-4 w-4 shrink-0 text-volt" strokeWidth={1.9} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-paper">maya-and-theo.zip</span>
          <Download className="h-3.5 w-3.5 shrink-0 text-paper/70" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-canvas-line">
          <div
            className="vg-run h-full origin-left rounded-full bg-volt"
            style={loop("vg-fill", 3.6, 0, "cubic-bezier(0.45, 0, 0.2, 1)")}
          />
        </div>
      </Panel>
    </div>
  );
}
