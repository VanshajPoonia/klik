"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CreditCard, Phone, QrCode, Timer, X } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import type { PlanDefinition } from "@/lib/plans";
import { KIT_WAIT_MINUTES, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

/**
 * What a plan button does now: explain the next few minutes, then go.
 *
 * The thing being explained is the gap. A plan is granted by a person rather
 * than by the webhook (BILLING.md, "The grant is manual"), so there is real time
 * between a card clearing and a gallery existing. Said here it is a short wait.
 * Discovered afterwards, on an empty dashboard, it is a failed payment, and the
 * next thing that happens is a chargeback.
 *
 * Built on the native <dialog>. `showModal()` gives the focus trap, the Escape
 * key, the inert background and the `::backdrop` for free, all of which are
 * tedious and easy to get subtly wrong by hand.
 */
export function PlanDialog({
  plan,
  cta,
  className = "",
  variant = "primary",
}: {
  plan: PlanDefinition;
  /** The label on the button that opens this. */
  cta: string;
  className?: string;
  variant?: "primary" | "ghost";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  /**
   * Always the signup page, never the Stripe link directly, and the same for
   * everyone. app/signup/page.tsx redirects a visitor who is already signed in
   * straight on to payment, which means this component needs no session and the
   * marketing page it lives on stays statically rendered.
   */
  const continueHref = `/signup?plan=${plan.key}`;

  // showModal() cannot be called during render, and calling it on an element
  // that is already open throws, so opening is driven from state rather than
  // from the click handler.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape and the browser's own dismissal both fire `close` without going
  // through our state. Without this the dialog shuts and React still believes
  // it is open, so the next click on the button does nothing at all.
  const handleClose = useCallback(() => setOpen(false), []);

  const steps: Array<{ icon: typeof CreditCard; title: string; body: string }> = [
    {
      icon: CreditCard,
      title: "Make the payment",
      body:
        "Your details first, so the payment can be matched to your account, then Stripe's own secure page. Card details never reach Klik.",
    },
    {
      icon: Timer,
      title: `Wait about ${KIT_WAIT_MINUTES} minutes`,
      body:
        "We put your kit together once the payment clears: your live gallery, your QR code and the printable sign your guests scan.",
    },
    {
      icon: QrCode,
      title: "Put the QR out",
      body:
        "On the tables, by the door, on the bar. Guests scan it and add photos and videos. No app, no account, no sign-up for them.",
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName({ variant, className: `w-full ${className}` })}
      >
        {cta}
      </button>

      <dialog
        ref={dialogRef}
        onClose={handleClose}
        // The backdrop is the dialog's own box once its padding is zero, so a
        // click landing on the element itself is a click outside the panel.
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby={`plan-dialog-${plan.key}-title`}
        // `m-auto` is not decoration: Tailwind's preflight zeroes the margin on
        // every element, including the `margin: auto` a modal <dialog> relies on
        // to centre itself. Without it the panel sits in the top-left corner.
        //
        // The height cap and overflow are explicit rather than inherited from
        // the UA stylesheet. Three steps, a support box and two buttons is taller
        // than a small phone in landscape, and the page behind a modal dialog
        // cannot be scrolled to reach the rest.
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-[18px] border border-canvas-line bg-canvas-raised p-0 text-paper backdrop:bg-canvas/80"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-canvas hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>

          <p className="text-xs font-semibold tracking-[0.14em] text-volt uppercase">
            How this works
          </p>
          <h2
            id={`plan-dialog-${plan.key}-title`}
            className="mt-2 pr-10 font-display text-2xl leading-tight tracking-tight text-paper"
          >
            {plan.name}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {plan.price} {plan.priceSuffix}
            {plan.billingNote ? `, ${plan.billingNote.toLowerCase()}` : ""}
          </p>

          <ol className="mt-6 space-y-5">
            {steps.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="flex gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-volt/10 text-volt"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-paper">
                    <span className="text-muted">{index + 1}. </span>
                    {title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-canvas-line bg-canvas p-4">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-volt text-volt"
            >
              <Phone className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <p className="text-sm leading-relaxed text-muted">
              Something wrong, or an event today? Call or text{" "}
              <a
                href={SUPPORT_PHONE_HREF}
                className="font-semibold text-paper hover:text-volt"
              >
                {SUPPORT_PHONE}
              </a>
              . A person answers.
            </p>
          </div>

          <Link
            href={continueHref}
            className={buttonClassName({ size: "lg", className: "mt-6 w-full" })}
          >
            Continue to payment
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full py-2 text-sm text-muted transition-colors hover:text-paper"
          >
            Not yet
          </button>
        </div>
      </dialog>
    </>
  );
}
