import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { KIT_WAIT_MINUTES, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

/**
 * What an account sees between signing up and being granted a plan.
 *
 * Shown in place of the create-event form, which is the honest arrangement: the
 * form would be refused by the API anyway (app/api/events/route.ts checks
 * `activated_at`), and offering a control that cannot work is worse than
 * explaining why it is missing.
 *
 * Two audiences, which is why there are two paragraphs. Somebody who has not
 * paid needs the plans. Somebody who has paid needs to know a person is coming
 * and how to hurry them, because from here a cleared payment and a lost payment
 * look identical.
 */
export function AwaitingActivation() {
  return (
    <Card className="space-y-5 border-volt/30">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-volt uppercase">
          Account created
        </p>
        <h2 className="mt-2 font-display text-xl leading-tight text-paper">
          One step left before you can create an event
        </h2>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        Your account is ready. Choosing a plan is what turns on event creation, your QR code and
        your gallery.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/#pricing" className={buttonClassName({})}>
          See the plans
        </Link>
        <a
          href={SUPPORT_PHONE_HREF}
          className={buttonClassName({ variant: "ghost" })}
        >
          Call {SUPPORT_PHONE}
        </a>
      </div>

      <p className="border-t border-canvas-line pt-4 text-sm leading-relaxed text-muted">
        <span className="font-semibold text-paper">Already paid?</span> Your kit takes about{" "}
        {KIT_WAIT_MINUTES} minutes to put together, and this page turns on by itself once it is
        done. If it has been longer than that, call or text {SUPPORT_PHONE} and we will sort it out
        on the spot.
      </p>
    </Card>
  );
}
