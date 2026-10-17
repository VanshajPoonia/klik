import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { lookupPasswordLink } from "@/lib/password-links";
import { PASSWORD_MIN } from "@/lib/signup";
import { buttonClassName } from "@/components/ui/button";
import { ChoosePasswordForm } from "@/components/auth/choose-password-form";

export const metadata: Metadata = {
  title: "Choose your password",
  robots: { index: false, follow: false },
};

/**
 * ACC-8: where the emailed link to choose a password lands. Looking at the
 * page spends nothing; only setting the password does, so a mail scanner that
 * opens every link cannot use one up.
 */
export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await lookupPasswordLink(token);

  if (link.state !== "valid") {
    const [heading, lede] = {
      used: ["This link has been used", "It works once, and a newer email replaces it. If you set your password already, sign in with it."],
      expired: ["This link has expired", "It works for seven days. Ask whoever runs your Klik account to send another."],
      missing: ["This link is not valid", "Check you opened the whole link from the email."],
    }[link.state];
    return (
      <Shell heading={heading} lede={lede}>
        <Link href="/login" className={buttonClassName({ variant: "ghost" })}>
          Go to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell heading="Choose your password" lede="It is how you sign in to Klik from now on, with your username.">
      <ChoosePasswordForm token={token} username={link.username} min={PASSWORD_MIN} />
    </Shell>
  );
}

function Shell({ heading, lede, children }: { heading: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/klik-mark.png" alt="" width={36} height={36} className="rounded-[9px]" />
        <span className="text-xl font-semibold tracking-tight text-paper">klik</span>
      </Link>
      <h1 className="mt-10 max-w-md font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">{heading}</h1>
      <p className="mt-3 max-w-sm text-sm text-muted">{lede}</p>
      <div className="mt-9 flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
