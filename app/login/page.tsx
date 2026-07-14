import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === "superadmin" ? "/admin" : "/dashboard");
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
        <LoginForm googleEnabled={googleEnabled} resendEnabled={resendEnabled} />
      </div>
    </div>
  );
}
