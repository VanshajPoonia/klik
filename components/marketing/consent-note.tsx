import { Container } from "./container";
import { CURRENT_CONSENT } from "@/lib/consent";

export function ConsentNote() {
  return (
    <section className="bg-canvas py-24 sm:py-32">
      <Container className="max-w-2xl text-center">
        <h2 className="font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">
          Guests know exactly what they&rsquo;re sharing.
        </h2>
        <p className="mt-5 leading-relaxed text-muted">
          Before anyone uploads, this is the notice they see, word for word:
        </p>
        {/* Quoted from lib/consent.ts rather than paraphrased, so the promise
            made on the marketing page cannot drift from the one guests are
            actually shown. */}
        <blockquote className="mt-5 rounded-2xl border border-canvas-line bg-canvas-raised p-6 text-left leading-relaxed text-paper">
          {CURRENT_CONSENT.statement}
        </blockquote>
        <p className="mt-5 leading-relaxed text-muted">{CURRENT_CONSENT.detail}</p>
      </Container>
    </section>
  );
}
