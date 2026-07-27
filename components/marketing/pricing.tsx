import { Check, CloudDownload, QrCode, ShieldCheck, Users } from "lucide-react";
import { PLANS, type PlanDefinition } from "@/lib/plans";
import { Container } from "./container";
import { CtaLink } from "./cta-link";

function PlanFeatures({
  plan,
  inverted = false,
}: {
  plan: PlanDefinition;
  inverted?: boolean;
}) {
  return (
    <ul className="mt-8 space-y-3">
      {plan.features.map((feature) => (
        <li
          key={feature}
          className={`flex items-start gap-3 text-sm leading-relaxed ${
            inverted ? "text-paper/80" : "text-canvas/75"
          }`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              inverted ? "bg-volt text-canvas" : "bg-canvas text-volt"
            }`}
          >
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          </span>
          {feature}
        </li>
      ))}
    </ul>
  );
}

export function Pricing() {
  const eventPlan = PLANS.event;
  const premiumPlan = PLANS.premium;
  const venuePlan = PLANS.venue;
  const assurances = [
    {
      icon: Users,
      title: "Share with everyone",
      body: "Unlimited guests can join.",
    },
    {
      icon: ShieldCheck,
      title: "Secure and private",
      body: "You control gallery access.",
    },
    {
      icon: CloudDownload,
      title: "Download and keep",
      body: "Save original photos and videos.",
    },
    {
      icon: QrCode,
      title: "One scan to join",
      body: "Every event gets a QR code.",
    },
  ];

  return (
    <section id="pricing" className="scroll-mt-8 bg-paper py-24 text-canvas sm:py-32">
      <Container>
        <div className="grid gap-8 border-b border-canvas/15 pb-12 lg:grid-cols-[1fr_0.7fr] lg:items-end">
          <h2 className="max-w-3xl font-display text-4xl leading-[1.04] tracking-tight sm:text-6xl">
            One event, a longer run, or the whole venue.
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-canvas/65 lg:justify-self-end">
            No surprise guest fees. Your assigned plan controls active events, upload time, gallery
            access, and video size.
          </p>
        </div>

        <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-12">
          <article className="flex flex-col overflow-hidden rounded-2xl border border-volt bg-paper lg:col-span-4">
            <div className="bg-volt px-6 py-2 text-center text-sm font-semibold text-canvas">
              Most popular
            </div>
            <div className="flex flex-1 flex-col p-6 sm:p-8">
              <div>
                <h3 className="font-display text-3xl leading-tight">{eventPlan.name}</h3>
                <p className="mt-3 max-w-xs text-sm leading-relaxed text-canvas/65">
                  {eventPlan.description}
                </p>
              </div>
              <div className="mt-8 flex items-end gap-3">
                <span className="font-display text-6xl leading-none text-volt-dim">
                  {eventPlan.price}
                </span>
                <span className="max-w-24 pb-1 text-xs font-medium leading-tight text-canvas/65">
                  {eventPlan.priceSuffix}
                </span>
              </div>
              {eventPlan.priceNote && (
                <p className="mt-3 border-b border-canvas/20 pb-6 text-sm font-medium text-canvas/70">
                  {eventPlan.priceNote}
                </p>
              )}
              <PlanFeatures plan={eventPlan} />
              <CtaLink href="/login" className="mt-8 w-full">
                Start with Event
              </CtaLink>
            </div>
          </article>

          <article className="flex flex-col rounded-2xl bg-canvas p-6 text-paper lg:col-span-4 sm:p-8">
            <div>
              <h3 className="font-display text-3xl leading-tight">{premiumPlan.name}</h3>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-paper/65">
                {premiumPlan.description}
              </p>
            </div>
            <div className="mt-8 flex items-end gap-3">
              <span className="font-display text-6xl leading-none text-volt">
                {premiumPlan.price}
              </span>
              <span className="pb-1 text-xs text-muted">{premiumPlan.priceSuffix}</span>
            </div>
            <div className="mt-6 border-b border-paper/15" />
            <PlanFeatures plan={premiumPlan} inverted />
            <CtaLink href="/login" className="mt-auto w-full">
              Choose Premium
            </CtaLink>
          </article>

          <article className="flex flex-col rounded-2xl border border-canvas/20 bg-paper p-6 lg:col-span-4 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-3xl leading-tight">{venuePlan.name}</h3>
                <p className="mt-3 max-w-xs text-sm leading-relaxed text-canvas/65">
                  {venuePlan.description}
                </p>
              </div>
              <span className="rounded-full bg-volt px-3 py-1 text-xs font-medium text-canvas">
                Up to 5
              </span>
            </div>
            <div className="mt-8 flex items-end gap-3">
              <span className="font-display text-6xl leading-none">{venuePlan.price}</span>
              <span className="max-w-20 pb-1 text-xs leading-tight text-canvas/65">
                {venuePlan.priceSuffix}
              </span>
            </div>
            {venuePlan.priceNote && (
              <p className="mt-3 text-xs text-canvas/60">{venuePlan.priceNote}</p>
            )}
            <div className="mt-6 border-b border-canvas/20" />
            <PlanFeatures plan={venuePlan} />
            <CtaLink
              href="/login"
              variant="ghost"
              className="mt-auto w-full border-canvas bg-canvas text-paper hover:border-canvas"
            >
              Choose Venue
            </CtaLink>
          </article>
        </div>

        <div className="mt-6 grid overflow-hidden rounded-2xl bg-canvas text-paper sm:grid-cols-2 lg:grid-cols-4">
          {assurances.map(({ icon: Icon, title, body }, index) => (
            <div
              key={title}
              className={`flex items-center gap-4 p-5 ${
                index > 0 ? "border-t border-canvas-line lg:border-t-0 lg:border-l" : ""
              } ${index === 1 ? "sm:border-t-0 sm:border-l" : ""} ${
                index === 2 ? "sm:border-l-0" : ""
              } ${index === 3 ? "sm:border-l" : ""}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-volt text-volt">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-volt">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-paper/65">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-canvas/60">
          Plans are assigned by the Klik administrator during onboarding. Payment checkout is not
          connected yet.
        </p>
      </Container>
    </section>
  );
}
