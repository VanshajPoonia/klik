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
  const { plan } = await searchParams;
  const session = await auth();

  // Someone arriving from the pricing page has already chosen a plan. Carrying
  // it through sign-in is the difference between coming back to the thing they
  // clicked and being dropped on the dashboard wondering what happened.
  if (!session?.user) {
    const next = isPlanKey(plan) ? `/checkout?plan=${plan}` : "/checkout";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // The plan is a choice between the three keys the app already knows. The price
  // it maps to is resolved on the server from the environment, so a hand-edited
  // query string can pick a different plan to look at and still cannot pick
  // what it costs.
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
      {/* Said before paying, not after. A plan is granted by a person, so the
          gap between the card clearing and the event going live is real and
          measured in hours. Someone who was not told will read it as a failure
          and ask for their money back. */}
      <p className="mt-2 text-sm text-muted">
        Your plan is applied by the Klik team once the payment clears. You will not see it on your
        events straight away.
      </p>
      <Card className="mt-8">
        <EmbeddedCheckoutForm planKey={plan} />
      </Card>
    </main>
  );
}
