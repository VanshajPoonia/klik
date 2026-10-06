import { Container } from "./container";
import { CtaLink } from "./cta-link";

export function FinalCta() {
  return (
    <section className="bg-canvas-raised py-24 sm:py-32">
      <Container className="flex flex-col items-center text-center">
        <h2 className="max-w-2xl font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
          Your next event already has a photographer. Actually, it has all of them.
        </h2>
        <p className="mt-5 max-w-md text-lg text-muted">
          Create the gallery, download the QR code, and put it on the table.
        </p>
        <CtaLink href="/signup" size="lg" className="mt-9">
          Create your event
        </CtaLink>
      </Container>
    </section>
  );
}
