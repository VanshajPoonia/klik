import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/plans";
import { EmbeddedCheckoutForm } from "@/components/billing/embedded-checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

function isPlanKey(value: string | undefined): value is PlanKey {
  return PLAN_KEYS.includes(value as PlanKey);
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // The plan comes from the URL, but only as a choice between the three keys
  // the app already knows. The price it maps to is resolved on the server from
  // the environment, so a hand-edited query string can pick a different plan to
  // look at and still cannot pick what it costs.
  const { plan } = await searchParams;
  if (!isPlanKey(plan)) notFound();
  const definition = PLANS[plan];

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="font-display text-2xl leading-tight tracking-tight text-paper">
        {definition.name}
      </h1>
      <p className="mt-3 text-sm text-muted">
        {definition.price} {definition.priceSuffix}. Payment is handled by Stripe, and card details
        are entered in Stripe&apos;s own frame without ever reaching Klik.
      </p>
      <Card className="mt-8">
        <EmbeddedCheckoutForm planKey={plan} />
      </Card>
    </main>
  );
}
