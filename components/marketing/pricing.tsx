import {
  Building2,
  CalendarDays,
  Check,
  CloudDownload,
  QrCode,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PLANS, type PlanDefinition } from "@/lib/plans";
import { KIT_WAIT_MINUTES, SUPPORT_PHONE } from "@/lib/support";
import { Container } from "./container";
import { PlanDialog } from "./plan-dialog";

function PlanFeatures({
  plan,
  inverted = false,
}: {
  plan: PlanDefinition;
  inverted?: boolean;
}) {
  return (
    <ul className="space-y-3.5">
      {plan.features.map((feature) => (
        <li
          key={feature}
          className={`flex items-start gap-3 text-sm leading-relaxed ${
            inverted ? "text-paper/80" : "text-canvas/80"
          }`}
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-volt text-canvas">
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          </span>
          {feature}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({
  plan,
  inverted = false,
  icon: Icon,
  cta,
}: {
  plan: PlanDefinition;
  inverted?: boolean;
  icon: LucideIcon;
  cta: string;
}) {
  const isFeatured = Boolean(plan.featured);

  return (
    <article
      className={`flex min-w-0 flex-col overflow-hidden rounded-[18px] border ${
        inverted
          ? "border-canvas bg-canvas text-paper"
          : isFeatured
            ? "border-volt bg-paper text-canvas"
            : "border-canvas/20 bg-paper text-canvas"
      }`}
    >
      {isFeatured && (
        <p className="bg-volt px-6 py-2 text-center text-xs font-semibold tracking-[0.14em] text-canvas uppercase">
          Most popular
        </p>
      )}

      <div className="flex flex-1 flex-col">
        <div className="px-6 pb-7 pt-7 sm:px-7">
          <h3 className="text-3xl font-semibold leading-tight tracking-[-0.03em]">{plan.name}</h3>
          <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-2">
            <span
              className={`text-6xl font-semibold leading-none tracking-[-0.06em] sm:text-7xl ${
                inverted ? "text-volt" : "text-canvas"
              }`}
            >
              {plan.price}
            </span>
            <span
              className={`max-w-24 pb-1 text-xs font-semibold leading-tight uppercase ${
                inverted ? "text-paper/65" : "text-canvas/60"
              }`}
            >
              {plan.priceSuffix}
            </span>
          </div>
          {plan.billingNote && (
            <p className="mt-5 rounded-full bg-volt px-4 py-2 text-center text-xs font-semibold tracking-wide text-canvas uppercase">
              {plan.billingNote}
            </p>
          )}
          {plan.priceNote && (
            <p
              className={`mt-3 text-center text-sm ${inverted ? "text-paper/70" : "text-canvas/70"}`}
            >
              {plan.priceNote}
            </p>
          )}
        </div>

        <div
          className={`flex-1 border-t px-6 py-7 sm:px-7 ${
            inverted ? "border-paper/15" : "border-canvas/15"
          }`}
        >
          <PlanFeatures plan={plan} inverted={inverted} />
        </div>

        <div
          className={`mt-auto border-t p-5 ${
            inverted
              ? "border-paper/15 bg-canvas-raised"
              : isFeatured
                ? "border-volt bg-volt text-canvas"
                : "border-canvas/15 bg-canvas text-paper"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${
                inverted || !isFeatured
                  ? "border-volt text-volt"
                  : "border-canvas text-canvas"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <p
              className={`pt-0.5 text-sm leading-relaxed ${
                inverted || !isFeatured ? "text-paper/75" : "text-canvas/75"
              }`}
            >
              {plan.description}
            </p>
          </div>
          {/* Opens the explainer rather than going straight to Stripe. Buying
              means creating an account first, so the payment can be matched to
              somebody, and it means a short wait afterwards. Both are better
              learned here than discovered on Stripe's page or on an empty
              dashboard. */}
          <PlanDialog
            plan={plan}
            cta={cta}
            variant={inverted ? "primary" : "ghost"}
            className={`mt-5 ${
              inverted
                ? ""
                : isFeatured
                  ? "border-canvas bg-canvas text-paper hover:border-canvas"
                  : "border-paper bg-paper text-canvas hover:border-paper"
            }`}
          />
        </div>
      </div>
    </article>
  );
}

export function Pricing() {
  const eventPlan = PLANS.event;
  const premiumPlan = PLANS.premium;
  const venuePlan = PLANS.venue;
  const assurances = [
    {
      icon: CalendarDays,
      title: "Pay once",
      body: "Event and Premium have no subscription.",
    },
    {
      icon: ShieldCheck,
      title: "Secure & private",
      body: "You control who can view it.",
    },
    {
      icon: CloudDownload,
      title: "Download and keep",
      body: "Save approved photos and videos.",
    },
    {
      icon: QrCode,
      title: "One QR",
      body: "Everyone shares. You keep everything.",
    },
  ];

  return (
    <section id="pricing" className="scroll-mt-8 bg-paper py-24 text-canvas sm:py-32">
      <Container>
        <div className="border-b border-canvas/15 pb-12 text-center">
          <h2 className="mx-auto max-w-4xl font-display text-4xl leading-[1.04] tracking-tight sm:text-6xl">
            Share more. Remember everything.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-canvas/65">
            Choose one event, a premium experience, or a plan for the whole venue. Every option
            includes unlimited guests with no per-person fees.
          </p>
        </div>

        <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-3">
          <PlanCard plan={eventPlan} icon={Users} cta="Start with Event" />
          <PlanCard plan={premiumPlan} icon={Sparkles} cta="Choose Premium" inverted />
          <PlanCard plan={venuePlan} icon={Building2} cta="Choose Venue" />
        </div>

        <div className="mt-6 grid overflow-hidden rounded-[18px] bg-canvas text-paper sm:grid-cols-2 lg:grid-cols-4">
          {assurances.map(({ icon: Icon, title, body }, index) => (
            <div
              key={title}
              className={`flex items-center gap-4 p-5 ${
                index === 1 ? "border-t border-paper/10 sm:border-l sm:border-t-0" : ""
              } ${index === 2 ? "border-t border-paper/10 lg:border-l lg:border-t-0" : ""} ${
                index === 3
                  ? "border-t border-paper/10 sm:border-l lg:border-t-0"
                  : ""
              }`}
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
          You create an account, pay through Stripe, and your kit is ready in about{" "}
          {KIT_WAIT_MINUTES} minutes. Questions before you buy? Call or text {SUPPORT_PHONE}.
        </p>
      </Container>
    </section>
  );
}
