import { MessageSquare, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

/**
 * How to reach a person, on every organizer's dashboard.
 *
 * On the dashboard rather than in a help centre because of when it is needed. An
 * organizer looking for this is standing at a venue with guests arriving and a
 * QR code that is not working, and the dashboard is the screen already in front
 * of them.
 *
 * `tel:` and `sms:` rather than a contact form. The device this is read on is a
 * phone, and the useful thing a phone can do with a phone number is dial it.
 */
export function SupportCard() {
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-volt text-volt"
        >
          <Phone className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-paper">Need a hand?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Call or text{" "}
            <a href={SUPPORT_PHONE_HREF} className="font-semibold text-paper hover:text-volt">
              {SUPPORT_PHONE}
            </a>
            . If your event is today, say so and we will come to you first.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <a
          href={SUPPORT_PHONE_HREF}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-volt px-5 py-2.5 text-sm font-medium text-on-volt transition-transform duration-150 ease-out hover:brightness-95 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          Call
        </a>
        <a
          href={SUPPORT_PHONE_HREF.replace("tel:", "sms:")}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-canvas-line px-5 py-2.5 text-sm font-medium text-paper transition-transform duration-150 ease-out hover:border-paper/40 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Text
        </a>
      </div>
    </Card>
  );
}
