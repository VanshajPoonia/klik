import { Container } from "./container";

export function ConsentNote() {
  return (
    <section className="bg-canvas py-24 sm:py-32">
      <Container className="max-w-2xl text-center">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-volt">Privacy</span>
        <h2 className="mt-5 font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">
          Guests know exactly what they&rsquo;re sharing.
        </h2>
        <p className="mt-5 leading-relaxed text-muted">
          Before anyone uploads, they see a plain consent notice: their photo may be visible to
          everyone with access to the gallery. No hidden data collection, no account required,
          nothing shared beyond this one event.
        </p>
      </Container>
    </section>
  );
}
