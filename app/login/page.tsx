import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { safeInternalPath } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Untrusted, and the reason safeInternalPath exists: without it this is an
  // open redirect that signs someone in and hands them to another site.
  const next = safeInternalPath((await searchParams).next);

  const session = await auth();
  if (session?.user) {
    redirect(next ?? (session.user.role === "superadmin" ? "/admin" : "/dashboard"));
  }

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const resendEnabled = Boolean(process.env.AUTH_RESEND_KEY);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/klik-mark.png" alt="" width={36} height={36} className="rounded-[9px]" />
        <span className="text-xl font-semibold tracking-tight text-paper">klik</span>
      </Link>
      <h1 className="mt-10 max-w-md font-display text-3xl leading-tight tracking-tight text-paper sm:text-4xl">
        Sign in to your dashboard
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted">
        Organizer and venue accounts sign in here. Guests never need an account.
      </p>
      <div className="mt-9 flex justify-center">
        <LoginForm googleEnabled={googleEnabled} resendEnabled={resendEnabled} next={next} />
      </div>

      <p className="mt-7 text-sm text-muted">
        New to Klik?{" "}
        <Link href="/signup" className="font-medium text-volt hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
