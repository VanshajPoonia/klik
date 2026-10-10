import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, CreditCard, ExternalLink } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { entitlements, events } from "@/lib/schema";
import { env } from "@/lib/env";
import { PLANS, getPlan } from "@/lib/plans";
import { creditBalance, formatCents } from "@/lib/referrals";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";
import { KIT_WAIT_HOURS, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";

export const metadata: Metadata = { title: "Billing", robots: { index: false } };

const day = (date: Date) => date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/**
 * PAY-5: what an organizer has bought and how to pay for more. Built on the
 * entitlement ledger, which is what actually grants anything (BILLING.md).
 * Klik sells through hosted Stripe links and keeps no card or invoice itself,
 * so receipts and card changes are Stripe's: its customer portal when one is
 * set up, a person otherwise.
 */
export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/dashboard/billing");
  const userId = session.user.id;

  const [grants, credit] = await Promise.all([
    db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(desc(entitlements.createdAt)),
    creditBalance(userId),
  ]);
  const spentOn = grants.map((grant) => grant.appliedEventId).filter((id): id is string => Boolean(id));
  const eventNames = new Map(
    spentOn.length
      ? (await db.select({ id: events.id, name: events.name }).from(events).where(and(inArray(events.id, spentOn)))).map((row) => [
          row.id,
          row.name,
        ])
      : [],
  );
  const now = new Date();
  const portal = env.STRIPE_BILLING_PORTAL_URL;

  const rows = grants.map((grant) => {
    const plan = getPlan(grant.planKey);
    const ended = grant.status !== "active" || (grant.endsAt !== null && grant.endsAt <= now);
    if (grant.scope === "account") {
      return {
        id: grant.id,
        title: plan.name,
        detail: grant.status === "revoked"
          ? "Ended"
          : grant.graceStartedAt && grant.endsAt
            ? `Payment did not go through. Everything works until ${day(grant.endsAt)}.`
            : grant.endsAt
              ? ended
                ? `Ended ${day(grant.endsAt)}`
                : `Until ${day(grant.endsAt)}`
              : `Since ${day(grant.createdAt)}. Renews monthly.`,
        tone: ended ? ("neutral" as const) : grant.graceStartedAt ? ("warning" as const) : ("volt" as const),
        badge: ended ? "ended" : grant.graceStartedAt ? "payment needed" : "active",
      };
    }
    const used = grant.appliedEventId ? (eventNames.get(grant.appliedEventId) ?? "an event since removed") : null;
    return {
      id: grant.id,
      title: `${plan.name} pass`,
      detail: grant.status === "revoked" ? "Refunded or withdrawn" : used ? `Used for ${used}` : "Not used yet. Your next event goes live with it.",
      tone: grant.status === "revoked" ? ("neutral" as const) : used ? ("neutral" as const) : ("warning" as const),
      badge: grant.status === "revoked" ? "ended" : used ? "used" : "unused",
    };
  });

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 md:px-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <h1 className="font-display text-2xl text-paper">Billing</h1>
        <p className="mt-1 text-sm text-muted">What you have bought, and how to pay for more.</p>

        <div className="mt-8 space-y-5">
          <Card>
            <h2 className="text-sm font-medium text-paper">Your plans</h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing yet. Choose a plan below and your first event goes live with it.</p>
            ) : (
              <ul className="mt-3 divide-y divide-canvas-line rounded-xl border border-canvas-line">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-paper">{row.title}</span>
                      <span className="block text-xs text-muted">{row.detail}</span>
                    </span>
                    <Badge tone={row.tone}>{row.badge}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-md">
                <h2 className="flex items-center gap-2 text-sm font-medium text-paper">
                  <CreditCard className="h-4 w-4 text-volt" aria-hidden="true" />
                  Payments and receipts
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Payments go through Stripe, which emails a receipt each time. Klik never sees your card.
                  {portal
                    ? " Change your card, see invoices or cancel a Venue plan on Stripe's billing page."
                    : " For an invoice, a new card or to cancel a Venue plan, email or call us and a person sorts it out."}
                </p>
              </div>
              {portal ? (
                <a href={portal} target="_blank" rel="noopener noreferrer" className={buttonClassName({ variant: "ghost", size: "sm" })}>
                  Manage billing
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <span className="flex flex-col items-end gap-1 text-sm">
                  <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-volt hover:underline">
                    {LEGAL_CONTACT_EMAIL}
                  </a>
                  <a href={SUPPORT_PHONE_HREF} className="text-muted hover:text-paper">
                    {SUPPORT_PHONE}
                  </a>
                </span>
              )}
            </div>
            {credit > 0 && (
              <p className="mt-3 rounded-xl border border-canvas-line px-3 py-2 text-sm text-paper">
                You have <span className="font-medium">{formatCents(credit)}</span> of credit. We take it off your next
                payment.{" "}
                <Link href="/dashboard/account#referrals" className="text-volt hover:underline">
                  Where it came from
                </Link>
              </p>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-paper">Buy another event</h2>
            <p className="mt-1 text-xs text-muted">
              Pay on Stripe&apos;s page, and a person at Klik puts your event live, usually within {KIT_WAIT_HOURS} hours.
              You can set the event up while you wait.
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-3">
              {Object.values(PLANS).map((plan) => (
                <li key={plan.key} className="flex flex-col justify-between gap-3 rounded-xl border border-canvas-line p-3">
                  <span>
                    <span className="block text-sm font-medium text-paper">{plan.name}</span>
                    <span className="block text-xs text-muted">
                      {plan.price} {plan.priceSuffix}
                    </span>
                  </span>
                  <Link href={`/signup?plan=${plan.key}`} className={buttonClassName({ size: "sm" })}>
                    {plan.key === "venue" ? "Subscribe" : "Buy a pass"}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
