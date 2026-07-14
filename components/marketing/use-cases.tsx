import { Container } from "./container";

const cases = [
  "Weddings",
  "Birthdays",
  "Company parties",
  "Reunions",
  "Sporting events",
  "Anything worth remembering",
];

export function UseCases() {
  return (
    <section className="bg-canvas-raised py-24 sm:py-32">
      <Container className="text-center">
        <h2 className="font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
          One album. Any gathering.
        </h2>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {cases.map((label) => (
            <span
              key={label}
              className="rounded-full border border-canvas-line px-4 py-2 text-sm text-muted"
            >
              {label}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}
