import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { lookupInvite, normalizeEmail } from "@/lib/team";
import { ROLE_LABELS } from "@/lib/permissions";
import { buttonClassName } from "@/components/ui/button";
import { AcceptInviteButton } from "@/components/team/accept-invite-button";

export const metadata: Metadata = {
  title: "Join the team",
  robots: { index: false },
};

/**
 * ORG-3: where an invitation email lands.
 *
 * Joining needs an account with the invited address, so this page's job is to
 * get the person into exactly that state: create one, sign in to one, or swap
 * out of the wrong one. The token stays in the path the whole way round.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupInvite(token);
  const here = `/invite/${encodeURIComponent(token)}`;

  if (found.state !== "valid") {
    const copy = {
      accepted: ["This invitation has been used", "If it was you, the event is in your dashboard."],
      expired: ["This invitation has expired", "Ask the person who sent it to invite you again."],
      revoked: ["This invitation was withdrawn", "Ask the person who sent it if they meant to."],
      missing: ["This invitation is not valid", "Check you opened the whole link from the email."],
    }[found.state];
    return (
      <Shell heading={copy[0]} lede={copy[1]}>
        <Link href="/dashboard" className={buttonClassName({ variant: "ghost" })}>
          Go to your dashboard
        </Link>
      </Shell>
    );
  }

  const { invite, eventName, inviterName } = found;
  const role = ROLE_LABELS[invite.role as keyof typeof ROLE_LABELS];
  const heading = `${inviterName ?? "Someone"} invited you to help run ${eventName}`;
  const lede = role ? `As a ${role.label.toLowerCase()}. ${role.description}` : undefined;

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <Shell heading={heading} lede={lede}>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Link href={`/signup?invite=${encodeURIComponent(token)}`} className={buttonClassName({ className: "w-full" })}>
            Create a free account
          </Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className={buttonClassName({ variant: "ghost", className: "w-full" })}>
            I already have an account
          </Link>
        </div>
        <p className="mt-5 max-w-sm text-xs text-muted">
          Use {invite.email}. The invitation only works for that address.
        </p>
      </Shell>
    );
  }

  const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!account?.email || normalizeEmail(account.email) !== invite.email) {
    return (
      <Shell
        heading="This invitation is for a different address"
        lede={`It was sent to ${invite.email}, and you are signed in as ${account?.email ?? "an account without an email"}. Sign out, then sign in or sign up with ${invite.email}.`}
      >
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: `/login?next=${encodeURIComponent(here)}` });
          }}
        >
          <button className={buttonClassName({ variant: "ghost" })}>Sign out</button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell heading={heading} lede={lede}>
      <AcceptInviteButton token={token} />
    </Shell>
  );
}

function Shell({ heading, lede, children }: { heading: string; lede?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/klik-mark.png" alt="" width={36} height={36} className="rounded-[9px]" />
        <span className="text-xl font-semibold tracking-tight text-paper">klik</span>
      </Link>
      <h1 className="mt-10 max-w-md font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">
        {heading}
      </h1>
      {lede && <p className="mt-3 max-w-sm text-sm text-muted">{lede}</p>}
      <div className="mt-9 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
