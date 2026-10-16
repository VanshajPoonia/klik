import { Container } from "./container";
import { CtaLink } from "./cta-link";
import { FilmReel } from "./film-reel";

export function Hero() {
  return (
    <section className="relative overflow-x-clip pb-16 pt-10 sm:pb-24 sm:pt-16">
      <Container className="flex flex-col items-center text-center">
        <h1 className="max-w-4xl font-display text-[2.75rem] leading-[1.02] tracking-[-0.025em] text-paper sm:text-6xl lg:text-[4.75rem]">
          Every phone in the room just became <em className="italic text-volt">the photographer.</em>
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-muted sm:max-w-lg">
          Guests scan a QR code and add photos and videos from their own phone to one live album.
          No app, no account.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <CtaLink href="/signup" size="lg">
            Create your event
          </CtaLink>
          <CtaLink href="#how-it-works" variant="ghost" size="lg">
            See how it works
          </CtaLink>
        </div>
      </Container>
      <div className="mt-8 sm:mt-10">
        <FilmReel />
      </div>
    </section>
  );
}
