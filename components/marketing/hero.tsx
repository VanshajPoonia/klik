import { Container } from "./container";
import { CtaLink } from "./cta-link";
import { PhotoStack } from "./photo-stack";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-6 sm:pb-28 sm:pt-10">
      <Container>
        <div className="max-w-3xl">
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-paper sm:text-6xl lg:text-7xl">
            Every phone in the room just became <em className="italic">the photographer.</em>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
            Put a QR code on the table. Guests scan it, snap photos and videos on their own
            phone, and watch them land in one shared album - live, before the cake&rsquo;s even
            cut. No app to download, no account to make.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <CtaLink href="/login" size="lg">
              Create your event
            </CtaLink>
            <CtaLink href="#how-it-works" variant="ghost" size="lg">
              See how it works
            </CtaLink>
          </div>
        </div>
      </Container>
      <Container className="mt-16 sm:mt-20">
        <PhotoStack />
      </Container>
    </section>
  );
}
