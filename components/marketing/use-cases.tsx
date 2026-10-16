import Image from "next/image";
import type { CSSProperties } from "react";
import { Container } from "./container";
import { FilmCell } from "./film-cell";
import { GreaseMark } from "./grease-mark";
import { LoopVideo } from "./loop-video";
import { MOMENTS, type Moment } from "./sample-media";

const cases = [
  "Weddings",
  "Birthdays",
  "Company parties",
  "Reunions",
  "Sporting events",
  "Anything worth remembering",
];

type SheetFrame = {
  moment: Moment;
  n: string;
  position?: string;
  /** Circled in grease pencil and printed in colour; the rest of the sheet is black and white. */
  keeper?: boolean;
  loop?: boolean;
};

const strips: Array<{ tilt: string; from: "left" | "right"; frames: SheetFrame[] }> = [
  {
    tilt: "-1.4deg",
    from: "left",
    frames: [
      { moment: MOMENTS.wedding, n: "22", position: "20% 40%" },
      { moment: MOMENTS.wedding, n: "22A", keeper: true, loop: true },
      { moment: MOMENTS.birthday, n: "23", position: "70% 45%" },
      { moment: MOMENTS.birthday, n: "23A", position: "30% 40%" },
      { moment: MOMENTS.company, n: "24", position: "30% 50%" },
    ],
  },
  {
    tilt: "0.9deg",
    from: "right",
    frames: [
      { moment: MOMENTS.reunion, n: "25", position: "40% 50%" },
      { moment: MOMENTS.reunion, n: "25A", position: "75% 55%" },
      { moment: MOMENTS.shower, n: "26", position: "50% 30%" },
      { moment: MOMENTS.shower, n: "26A", keeper: true, loop: true },
      { moment: MOMENTS.graduation, n: "27", position: "30% 35%" },
    ],
  },
  {
    tilt: "-0.6deg",
    from: "left",
    frames: [
      { moment: MOMENTS.graduation, n: "28", loop: true },
      { moment: MOMENTS.company, n: "29", position: "70% 50%" },
      { moment: MOMENTS.wedding, n: "30", position: "70% 35%" },
      { moment: MOMENTS.birthday, n: "31", position: "50% 30%" },
      { moment: MOMENTS.reunion, n: "32", position: "20% 50%" },
    ],
  },
];

/**
 * The contact sheet on the light table: black and white strips with the
 * keepers circled and printed in colour. Any frame comes up in colour, and
 * lifts off the sheet, when the pointer is over it.
 */
export function UseCases() {
  return (
    <section className="overflow-x-clip bg-paper py-24 text-canvas sm:py-32">
      <Container className="text-center">
        <h2 className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          One album. Any gathering.
        </h2>
      </Container>

      <div className="sheet-rise mt-14 space-y-6 sm:mt-16 sm:space-y-8" aria-hidden="true">
        {strips.map((strip, stripIndex) => (
          <div
            key={stripIndex}
            className={`strip-tilt strip-in-${strip.from}`}
            style={{ "--strip-tilt": strip.tilt } as CSSProperties}
          >
            <div className="relative left-1/2 flex w-max -translate-x-1/2 shadow-[0_14px_30px_rgba(5,5,5,0.22)] [--sprocket-hole:var(--color-paper)]">
              {strip.frames.map((frame) => (
                <FilmCell
                  key={frame.n}
                  n={frame.n}
                  label={frame.moment.label}
                  className="w-[46vw] sm:w-[248px] lg:w-[288px]"
                >
                  <div className="group relative">
                    <div
                      className={`relative aspect-[3/2] overflow-hidden rounded-[2px] bg-canvas-raised transition-[transform,filter,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:z-10 hover:scale-[1.07] hover:shadow-[0_18px_36px_rgba(0,0,0,0.5)] ${
                        frame.keeper ? "" : "grayscale contrast-[1.08] hover:grayscale-0"
                      }`}
                    >
                      {frame.loop ? (
                        <LoopVideo
                          src={frame.moment.loop}
                          poster={frame.moment.poster}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <Image
                          src={frame.moment.still}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 46vw, (max-width: 1024px) 248px, 288px"
                          className="object-cover"
                          style={{ objectPosition: frame.position ?? "center" }}
                        />
                      )}
                    </div>
                    {frame.keeper && <GreaseMark onView className="-inset-x-2 -inset-y-4 z-10" />}
                  </div>
                </FilmCell>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Container>
        <ul className="mt-14 flex flex-wrap justify-center gap-2.5 sm:mt-16 sm:gap-3">
          {cases.map((label) => (
            <li
              key={label}
              className="rounded-full border border-canvas/20 px-4 py-2 text-sm text-canvas/75"
            >
              {label}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
