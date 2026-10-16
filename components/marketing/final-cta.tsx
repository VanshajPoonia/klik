import Image from "next/image";
import type { CSSProperties } from "react";
import { Container } from "./container";
import { CtaLink } from "./cta-link";
import { FilmCell } from "./film-cell";
import { GreaseMark } from "./grease-mark";
import { MOMENTS } from "./sample-media";

const rows = [
  [
    { moment: MOMENTS.graduation, position: "50% 30%" },
    { moment: MOMENTS.wedding, position: "30% 40%" },
    { moment: MOMENTS.reunion, position: "60% 50%" },
    { moment: MOMENTS.birthday, position: "70% 40%" },
    { moment: MOMENTS.shower, position: "45% 35%" },
    { moment: MOMENTS.company, position: "30% 50%" },
  ],
  [
    { moment: MOMENTS.birthday, position: "30% 45%" },
    { moment: MOMENTS.company, position: "70% 50%" },
    { moment: MOMENTS.shower, position: "70% 35%" },
    { moment: MOMENTS.wedding, position: "75% 35%" },
    { moment: MOMENTS.graduation, position: "25% 35%" },
    { moment: MOMENTS.reunion, position: "20% 50%" },
  ],
];

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden bg-canvas-raised py-28 sm:py-40">
      {/* The whole roll, drifting past on a wall behind the close. Doubled so
          the drift loops without a seam. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 flex flex-col justify-center gap-5 opacity-30 sm:opacity-45 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_50%,transparent_20%,black_75%)] [transform:perspective(1200px)_rotateX(22deg)_scale(1.15)]"
        aria-hidden="true"
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex w-max">
            <div
              className={`film-drift flex ${rowIndex % 2 ? "film-drift-reverse" : ""}`}
              style={{ "--drift": rowIndex % 2 ? "90s" : "75s" } as CSSProperties}
            >
              {[...row, ...row, ...row, ...row].map((frame, index) => (
                <FilmCell key={index} n={String(40 + index)} className="w-[220px] sm:w-[280px]">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-[2px] bg-canvas">
                    <Image
                      src={frame.moment.still}
                      alt=""
                      fill
                      sizes="280px"
                      className="object-cover"
                      style={{ objectPosition: frame.position }}
                    />
                  </div>
                </FilmCell>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Container className="flex flex-col items-center text-center">
        <h2 className="max-w-2xl font-display text-4xl leading-tight tracking-tight text-paper sm:text-6xl">
          Your next event already has a photographer. Actually, it has{" "}
          <span className="relative inline-block whitespace-nowrap">
            <em className="italic">all of them.</em>
            <GreaseMark kind="underline" onView className="-bottom-2 left-0 h-3 w-full sm:-bottom-3 sm:h-4" />
          </span>
        </h2>
        <p className="mt-6 max-w-md text-lg text-paper/70">
          Create the gallery, download the QR code, and put it on the table.
        </p>
        <CtaLink href="/signup" size="lg" className="mt-9">
          Create your event
        </CtaLink>
      </Container>
    </section>
  );
}
