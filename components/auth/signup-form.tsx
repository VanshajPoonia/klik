"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { PASSWORD_MIN } from "@/lib/signup";

export function SignupForm({
  /**
   * Where to send them once the account exists, or null to land on the
   * dashboard. Resolved on the server from a plan key, never read from the URL
   * here, because this is an off-origin destination and the whole protection is
   * that it came from our own table. See app/signup/page.tsx.
   */
  payUrl,
  planName,
  /** ORG-3: signing up to accept an invitation, which fixes the address. */
  invitation = null,
}: {
  payUrl: string | null;
  planName: string | null;
  invitation?: { token: string; email: string } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "Could not create the account");
        setLoading(false);
        return;
      }

      // Signed in with the email rather than the generated username, because the
      // email is the only identifier this person has been shown. The credentials
      // provider accepts either.
      const signedIn = await signIn("credentials", { username: email, password, redirect: false });
      if (!signedIn || signedIn.error) {
        // The account was created, so this is not a failure to report as one.
        // Sending them to sign in by hand is the honest recovery, and it works.
        router.push("/login");
        return;
      }

      if (invitation) {
        router.replace(`/invite/${encodeURIComponent(invitation.token)}`);
        router.refresh();
        return;
      }

      if (payUrl) {
        // A full navigation, not router.push. The destination is Stripe's own
        // page on another origin, which the client router cannot route to.
        // `replace` keeps the back button landing on the pricing page they came
        // from rather than on a signup form for an account that now exists.
        window.location.replace(payUrl);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach Klik. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 text-left">
      <Field label="Your name">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={120}
          required
        />
      </Field>

      <Field
        label="Email"
        hint={
          invitation
            ? "The address your invitation was sent to."
            : "Where your gallery links and receipts go."
        }
      >
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={Boolean(invitation)}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="signup-password"
        hint={`At least ${PASSWORD_MIN} characters.`}
      >
        <PasswordInput
          id="signup-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </Field>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading
          ? "Creating your account…"
          : payUrl
            ? "Create account and pay"
            : "Create account"}
      </Button>

      {planName && (
        <p className="text-center text-xs text-muted">
          Stripe&apos;s secure payment page for {planName} opens next.
        </p>
      )}
    </form>
  );
}
