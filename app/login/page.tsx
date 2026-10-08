import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
import { safeInternalPath } from "@/lib/safe-redirect";
import { SIGN_IN_CODE_COOKIE, describeSignInError, readSignInCodeCookie } from "@/lib/sign-in-errors";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  // Untrusted, and the reason safeInternalPath exists: without it this is an
  // open redirect that signs someone in and hands them to another site. Auth.js
  // sends a failed code back with `callbackUrl` rather than `next`.
  // ACC-2: after a failed code, the address and destination come back from a
  // cookie the form set, because Auth.js's error redirect carries neither.
  const remembered =
    params.error === "Verification" || params.error === "TooManyAttempts"
      ? readSignInCodeCookie((await cookies()).get(SIGN_IN_CODE_COOKIE)?.value)
      : null;
  const next =
    safeInternalPath(params.next) ?? safeInternalPath(params.callbackUrl) ?? safeInternalPath(remembered?.next);

  const session = await auth();
  if (session?.user) {
    redirect(next ?? "/after-sign-in");
  }

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  // Must match the condition lib/auth.ts registers the provider under. Gating
  // the button on the key alone would render "Continue with email" for a
  // provider that was never registered, and clicking it fails in next-auth
  // rather than anywhere that could explain why.
  const resendEnabled = Boolean(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL_FROM);

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
        {next?.startsWith("/e/") || next === "/me"
          ? "Keep the galleries you join in one place. Optional: you never need an account to share photos."
          : "Organizers, venues and guests with an account sign in here. Guests never need one to share photos."}
      </p>
      <div className="mt-9 flex justify-center">
        <LoginForm
          googleEnabled={googleEnabled}
          resendEnabled={resendEnabled}
          next={next}
          initialError={describeSignInError(params.error)}
          initialEmail={params.error === "Verification" ? (remembered?.email ?? null) : null}
        />
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
