import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignupForm } from "@/components/auth/signup-form";
import { PAYMENT_LINKS } from "@/lib/billing-plans";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/plans";
import { KIT_WAIT_HOURS, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";
import { lookupInvite } from "@/lib/team";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { cookies } from "next/headers";
import { REFERRAL_COOKIE, REFERRAL_CREDIT_CENTS, attachReferral, formatCents, referrerByCode } from "@/lib/referrals";

export const metadata: Metadata = {
  title: "Create your account",
};

function isPlanKey(value: string | undefined): value is PlanKey {
  return PLAN_KEYS.includes(value as PlanKey);
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; invite?: string }>;
}) {
  const { plan, invite: inviteToken } = await searchParams;

  // ORG-3: arriving from an invitation. The account is free and nothing is
  // bought, so a plan in the same link is ignored, and the email is the one the
  // invitation was sent to because no other address can accept it.
  const invited = inviteToken ? await lookupInvite(inviteToken) : null;
  const invitation =
    invited?.state === "valid" && inviteToken
      ? { token: inviteToken, email: invited.invite.email, eventName: invited.eventName }
      : null;

  /**
   * A plan key, never a URL.
   *
   * The payment page is on buy.stripe.com, so what happens after signup is a
   * redirect off this origin, and `safeInternalPath` exists precisely to refuse
   * those. Carrying one of three known keys and resolving the destination from
   * `PAYMENT_LINKS` here means the redirect target is chosen from a table in our
   * own code. A `?next=` would make it chosen by whoever wrote the link.
   */
  const planKey = !invitation && isPlanKey(plan) ? plan : null;
  const payUrl = planKey ? PAYMENT_LINKS[planKey] : null;

  const referralCode = (await cookies()).get(REFERRAL_COOKIE)?.value ?? null;
  const session = await auth();
  if (session?.user?.id && payUrl) {
    // ACC-2: a signed-in account on its way to pay. Recorded before it leaves
    // for Stripe, so the payment has an account in the admin queue to match.
    await db
      .update(users)
      .set({ organizerIntentAt: sql`COALESCE(${users.organizerIntentAt}, now())` })
      .where(eq(users.id, session.user.id));
    // GRW-5: a guest account becoming a customer through someone's link is
    // the path referrals exist for. Refused for an account already a customer.
    await attachReferral(session.user.id, referralCode).catch(() => false);
  }
  if (session?.user) {
    // Already signed in and came here from a plan button: send them on rather
    // than showing a signup form to somebody who has an account.
    redirect(
      invitation
        ? `/invite/${encodeURIComponent(invitation.token)}`
        : (payUrl ?? (session.user.role === "superadmin" ? "/admin" : "/dashboard")),
    );
  }

  const chosen = planKey ? PLANS[planKey] : null;
  // GRW-5: said up front, so the credit is not a surprise and the link visibly worked.
  const referrer = !invitation && referralCode ? await referrerByCode(referralCode) : null;
  const referrerName = referrer ? (referrer.name?.trim() || (referrer.username ? `@${referrer.username}` : null)) : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/klik-mark.png" alt="" width={36} height={36} className="rounded-[9px]" />
        <span className="text-xl font-semibold tracking-tight text-paper">klik</span>
      </Link>

      <h1 className="mt-10 max-w-md font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">
        {invitation
          ? `Create your account to join ${invitation.eventName}`
          : chosen
            ? `Create your account for ${chosen.name}`
            : "Create your Klik account"}
      </h1>

      {invitation ? (
        <p className="mt-3 max-w-sm text-sm text-muted">
          It is free. You are joining someone else&apos;s event, so there is nothing to pay.
        </p>
      ) : chosen ? (
        <p className="mt-3 max-w-sm text-sm text-muted">
          {chosen.price} {chosen.priceSuffix}. We take your details first so your payment can be
          matched to your account, then Stripe&apos;s secure page opens.
        </p>
      ) : (
        <p className="mt-3 max-w-sm text-sm text-muted">
          One account runs all your events. You choose a plan next, and nothing is charged until
          you do.
        </p>
      )}

      {referrerName && (
        <p className="mt-4 max-w-sm rounded-full border border-canvas-line px-4 py-2 text-xs text-paper">
          Invited by {referrerName}. Once your first event is live, you both get {formatCents(REFERRAL_CREDIT_CENTS)} of
          credit.
        </p>
      )}

      <div className="mt-9 flex justify-center">
        <SignupForm
          payUrl={payUrl}
          planName={chosen?.name ?? null}
          invitation={invitation ? { token: invitation.token, email: invitation.email } : null}
        />
      </div>

      <p className="mt-7 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={invitation ? `/login?next=${encodeURIComponent(`/invite/${invitation.token}`)}` : "/login"}
          className="font-medium text-volt hover:underline"
        >
          Sign in
        </Link>
      </p>

      {/* The wait is stated before anyone commits, not after. A plan is granted
          by a person, so the gap between paying and the kit being ready is real.
          Someone who was not told reads an empty dashboard as a failed payment. */}
      <p className="mt-10 max-w-sm text-xs leading-relaxed text-muted">
        After payment, your kit is ready within {KIT_WAIT_HOURS} hours. Any trouble, call or
        text{" "}
        <a href={SUPPORT_PHONE_HREF} className="font-medium text-paper hover:text-volt">
          {SUPPORT_PHONE}
        </a>
        .
      </p>
    </div>
  );
}
