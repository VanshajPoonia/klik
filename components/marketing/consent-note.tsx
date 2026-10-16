import { Check } from "lucide-react";
import { GUEST_COPY } from "@/lib/i18n/guest";
import { CURRENT_CONSENT } from "@/lib/consent";
import { Container } from "./container";
import { GreaseMark } from "./grease-mark";

const entry = GUEST_COPY.en.entry;

export function ConsentNote() {
  return (
    <section className="overflow-x-clip bg-canvas py-24 sm:py-32">
      <Container className="grid items-center gap-14 md:grid-cols-[1fr_auto] md:gap-20">
        <div className="max-w-md">
          <h2 className="font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
            Guests know exactly what they&rsquo;re sharing.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Before anyone uploads, this is the notice they see, word for word.
          </p>
        </div>

        {/* The guest entry sheet, drawn from the same strings the real one
            uses: the consent from lib/consent.ts and the labels from the guest
            copy, so the promise here cannot drift from what guests are shown. */}
        <figure className="phone-turn mx-auto w-[300px] max-w-full [transform:perspective(1600px)_rotateY(-6deg)_rotateX(2deg)] sm:w-[320px]">
          <div className="rounded-[46px] bg-canvas-raised p-[10px] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(243,241,233,0.08)]">
            <div className="relative overflow-hidden rounded-[37px] bg-canvas px-6 pb-8 pt-12">
              <span className="absolute left-1/2 top-3 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-canvas-raised" aria-hidden="true" />
              <div aria-hidden="true">
                <p className="text-center font-display text-2xl text-paper">Maya &amp; Theo</p>
                <p className="mt-1.5 text-center text-xs text-muted">{entry.join}</p>
                <p className="mt-7 text-xs font-medium text-paper/85">{entry.firstName}</p>
                <div className="mt-1.5 rounded-xl border border-canvas-line bg-canvas-raised px-3.5 py-2.5 text-sm text-paper">
                  Priya
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                {/* The tick is circled, never the words: the consent has to
                    stay readable. */}
                <span className="relative mt-0.5 h-5 w-5 shrink-0" aria-hidden="true">
                  <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-volt text-on-volt">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <GreaseMark onView className="-inset-3" />
                </span>
                <blockquote className="text-[13px] leading-relaxed text-paper">
                  {CURRENT_CONSENT.statement}
                </blockquote>
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-muted">{CURRENT_CONSENT.detail}</p>
              <div
                className="mt-6 rounded-full bg-volt py-2.5 text-center text-sm font-medium text-on-volt"
                aria-hidden="true"
              >
                {entry.continue}
              </div>
            </div>
          </div>
          <figcaption className="sr-only">
            The consent notice on the guest entry screen, quoted exactly.
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
