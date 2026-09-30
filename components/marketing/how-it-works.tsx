import { Container } from "./container";

const steps = [
  {
    n: "01",
    title: "Scan the code",
    body: "Guests point their camera at the QR code on your sign, table card, or screen. No app, no download.",
  },
  {
    n: "02",
    title: "Add a name, snap away",
    body: "A first name is optional. After that, it's just their camera roll: photos and videos, straight from the phone.",
  },
  {
    n: "03",
    title: "Watch the album fill up",
    body: "Every upload lands in the shared gallery within seconds, for every guest to see, download, and relive.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-canvas-raised py-24 sm:py-32">
      <Container>
        <h2 className="max-w-xl font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
          From scan to shared album in three steps.
        </h2>
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
          {steps.map((step) => (
            <div key={step.n}>
              <span className="font-display text-6xl text-volt/60">{step.n}</span>
              <h3 className="mt-4 text-xl font-medium text-paper">{step.title}</h3>
              <p className="mt-3 leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
