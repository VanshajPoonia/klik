import { qrLayout } from "@/lib/qr-shapes";

/**
 * A real, scannable QR code drawn with the same shapes the printed signs use,
 * so the code on the marketing page is the code a host actually puts out.
 */
export function QrGlyph({ value, className = "" }: { value: string; className?: string }) {
  const { span, shapes } = qrLayout(value, "rounded");
  return (
    <svg viewBox={`0 0 ${span} ${span}`} className={className} aria-hidden="true">
      <rect width={span} height={span} rx={2} className="fill-paper" />
      <g className="fill-canvas stroke-canvas">
        {shapes.map((shape, index) => {
          switch (shape.kind) {
            case "square":
              return <rect key={index} x={shape.x} y={shape.y} width={shape.size} height={shape.size} stroke="none" />;
            case "dot":
              return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} stroke="none" />;
            case "rounded":
              return (
                <rect
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  width={shape.size}
                  height={shape.size}
                  rx={shape.radius}
                  stroke="none"
                />
              );
            case "ring":
              return (
                <rect
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  width={shape.size}
                  height={shape.size}
                  rx={shape.radius}
                  fill="none"
                  strokeWidth={shape.stroke}
                />
              );
          }
        })}
      </g>
    </svg>
  );
}
