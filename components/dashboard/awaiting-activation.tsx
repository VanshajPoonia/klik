import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { KIT_WAIT_HOURS, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

/**
 * What an account with nothing to spend sees above the create form.
 *
 * Since ACT-3 the form is always there: a new event saves as a draft that the
 * organizer can name, date and design while they wait, and it goes live the
 * moment a pass or a Venue plan is granted. This card is what makes that
 * expected rather than a surprise.
 *
 * Two audiences, which is why the copy forks. Somebody who has not paid needs
 * the plans. Somebody who has paid needs to know a person is coming and how to
 * hurry them, because from here a cleared payment and a lost payment look
 * identical.
 */
export function AwaitingActivation({ activated = false }: { activated?: boolean }) {
  return (
    <Card className="space-y-5 border-volt/30">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-volt uppercase">
          {activated ? "Every pass is in use" : "Account created"}
        </p>
        <h2 className="mt-2 font-display text-xl leading-tight text-paper">
          {activated
            ? "Your next event starts as a draft"
            : "Set up your event now. It goes live once your plan is active"}
        </h2>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        A draft has everything except guests: name it, set the date, choose its look. The gallery,
        the QR code and uploads switch on when a plan is added to it.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/#pricing" className={buttonClassName({})}>
          {activated ? "Add a pass" : "See the plans"}
        </Link>
        <a href={SUPPORT_PHONE_HREF} className={buttonClassName({ variant: "ghost" })}>
          Call {SUPPORT_PHONE}
        </a>
      </div>

      <p className="border-t border-canvas-line pt-4 text-sm leading-relaxed text-muted">
        <span className="font-semibold text-paper">Already paid?</span> It is usually done within{" "}
        {KIT_WAIT_HOURS} hours, and your draft goes live by itself when it is. If it has been
        longer than that, call or text {SUPPORT_PHONE} and we will sort it out on the spot.
      </p>
    </Card>
  );
}
