import type { ComponentType } from "react";
import { Container } from "./container";
import { FilmCell } from "./film-cell";
import { InView } from "./in-view";
import { LandVignette, ScanVignette, SnapVignette } from "./step-vignettes";

const steps: Array<{ n: string; title: string; body: string; Vignette: ComponentType }> = [
  {
    n: "18",
    title: "Scan the code",
    body: "Point a phone at the QR on your sign, table card or screen.",
    Vignette: ScanVignette,
  },
  {
    n: "19",
    title: "Add a name, snap away",
    body: "A first name is optional. Then photos and videos, straight from the phone.",
    Vignette: SnapVignette,
  },
  {
    n: "20",
    title: "Watch the album fill up",
    body: "Every upload lands in the shared gallery within seconds.",
    Vignette: LandVignette,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="overflow-x-clip bg-canvas-raised py-24 sm:py-32">
      <Container>
        <h2 className="max-w-xl font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
          From scan to shared album in three steps.
        </h2>
      </Container>

      {/* One strip of film. On a phone it scrolls sideways, the way a roll is
          read; from md up the three frames sit side by side. */}
      <InView className="mt-14 sm:mt-16">
        <ol className="stagger mx-auto flex max-w-6xl snap-x snap-mandatory scroll-px-6 overflow-x-auto px-6 [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible md:px-10 [&::-webkit-scrollbar]:hidden">
          {steps.map(({ n, title, body, Vignette }) => (
            <li key={n} className="w-[82vw] max-w-[360px] shrink-0 snap-start md:w-auto md:max-w-none">
              <FilmCell n={n} label="Klik 400">
                <div className="develop relative aspect-[3/2] overflow-hidden rounded-[2px]">
                  <Vignette />
                </div>
              </FilmCell>
              <div className="pr-6 pt-6 md:pr-8">
                <h3 className="text-xl font-medium text-paper">{title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </InView>
    </section>
  );
}
