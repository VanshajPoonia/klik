"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { PlanKey } from "@/lib/plans";

/**
 * The parts of the `dahlia` Stripe.js build this page actually calls. The
 * Checkout Form SDK is in preview and publishes no types, so this models only
 * what is used here rather than pretending to describe the whole API.
 */
type StripeCheckoutForm = {
  mount: (selector: string) => void;
  on: (event: "confirm", handler: (confirmEvent: unknown) => void) => void;
};

type StripeLoadActionsResult =
  | {
      type: "success";
      actions: { confirm: (options: { formConfirmEvent: unknown }) => Promise<void> };
    }
  | { type: "error" };

type StripeCheckoutFormSdk = {
  createForm: (options: { layout: "expanded" }) => StripeCheckoutForm;
  loadActions: () => Promise<StripeLoadActionsResult>;
};

type StripeDahlia = {
  initCheckoutFormSdk: (options: {
    clientSecret: string;
    appearance: Record<string, unknown>;
  }) => StripeCheckoutFormSdk;
};

declare global {
  interface Window {
    Stripe?: (key: string, options?: { betas?: string[] }) => StripeDahlia;
  }
}

/**
 * Configured in Checkout Studio, not here. The form renders inside a
 * Stripe-hosted iframe that cannot read Klik's CSS variables, so this is the
 * only styling channel into it and the values have to be literals. Changing
 * them in Studio and re-running the integration is the intended path; editing
 * them here means the two drift apart silently.
 */
const appearance = {
  theme: "stripe",
  labels: "auto",
  inputs: "spaced",
  variables: {
    borderRadius: "4px",
    colorBackground: "#ffffff",
    colorDanger: "#df1b41",
    colorPrimary: "#0570de",
    colorSuccess: "#00c853",
    colorText: "#30313d",
    fontFamily: "Source Sans Pro",
    fontSizeBase: "16px",
    spacingUnit: "4px",
  },
};

export function EmbeddedCheckoutForm({ planKey }: { planKey: PlanKey }) {
  const [scriptReady, setScriptReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Strict Mode runs an effect, tears it down, and runs it again. Without this
   * guard that second pass mounts a second payment form into the same node, so
   * the bug only ever appears in development and looks like a Stripe fault.
   */
  const started = useRef(false);

  useEffect(() => {
    if (!scriptReady || started.current) return;
    started.current = true;

    void (async () => {
      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        setError("Payments are not configured for this environment.");
        return;
      }

      const stripe = window.Stripe?.(publishableKey, {
        betas: ["custom_checkout_payment_form_1"],
      });
      if (!stripe) {
        setError("Could not load Stripe. Check that no extension is blocking js.stripe.com.");
        return;
      }

      let clientSecret: string;
      try {
        const response = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planKey }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data?.client_secret !== "string") {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Could not start checkout.",
          );
        }
        clientSecret = data.client_secret;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not start checkout.");
        return;
      }

      const checkout = stripe.initCheckoutFormSdk({ clientSecret, appearance });
      const form = checkout.createForm({ layout: "expanded" });
      form.mount("#checkout-form");
      setMounted(true);

      const loadActionsResult = await checkout.loadActions();
      if (loadActionsResult.type !== "success") {
        setError("This payment form could not be prepared. Refresh and try again.");
        return;
      }

      form.on("confirm", (confirmEvent) => {
        void (async () => {
          try {
            await loadActionsResult.actions.confirm({ formConfirmEvent: confirmEvent });
          } catch (cause) {
            console.error("Payment confirmation error:", cause);
            setError("That payment could not be confirmed. Check the details and try again.");
          }
        })();
      });
    })();
  }, [scriptReady, planKey]);

  return (
    <>
      {/* Loaded straight from Stripe, never bundled or self-hosted: serving a
          copy of this file ourselves puts Klik in PCI scope. The `dahlia` build
          is the one that carries initCheckoutFormSdk. */}
      <Script
        src="https://js.stripe.com/dahlia/stripe.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Could not reach Stripe. Check your connection and try again.")}
      />

      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {!mounted && !error ? (
        <p className="text-sm text-muted">Loading the payment form...</p>
      ) : null}

      <div id="checkout-form" />
    </>
  );
}
