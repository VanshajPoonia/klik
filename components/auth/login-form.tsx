"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { SIGN_IN_CODE_COOKIE, describeSignInError } from "@/lib/sign-in-errors";

type Mode = "password" | "email" | "code";

export function LoginForm({
  googleEnabled,
  resendEnabled,
  next = null,
  initialError = null,
  initialEmail = null,
}: {
  googleEnabled: boolean;
  resendEnabled: boolean;
  /** Already sanitised on the server. Never read from the URL here. */
  next?: string | null;
  /** An `?error=` code, already mapped to a sentence on the server. */
  initialError?: string | null;
  /** Set when a code just failed: the address it was sent to, so a mistyped digit is one retry, not a new email. */
  initialEmail?: string | null;
}) {
  const router = useRouter();
  // ACC-2: a guest arriving from a gallery has no password to remember, so the
  // code is the first thing offered when it can be sent at all.
  const [mode, setMode] = useState<Mode>(
    initialEmail
      ? "code"
      : resendEnabled && (next?.startsWith("/e/") || next === "/me")
        ? "email"
        : "password",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const destination = next ?? "/after-sign-in";

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", { username, password, redirect: false });

      if (!result || result.error) {
        setError("Incorrect username or password.");
        setLoading(false);
        return;
      }

      router.push(destination);
      router.refresh();
    } catch {
      setError("Could not sign in. Check your connection and try again.");
      setLoading(false);
    }
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("resend", { email, redirect: false, callbackUrl: destination });
      setLoading(false);
      if (!result || result.error) {
        setError(describeSignInError(result?.error ?? "EmailSignin"));
        return;
      }
      setCode("");
      setMode("code");
    } catch {
      setError("Could not reach Klik. Check your connection and try again.");
      setLoading(false);
    }
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    // The same address the magic link would open. A full navigation, because
    // the response sets the session cookie and redirects, which the client
    // router cannot follow. A wrong code comes back to /login?error=.
    const target = new URL("/api/auth/callback/resend", window.location.origin);
    target.searchParams.set("email", email.trim().toLowerCase());
    target.searchParams.set("token", code.replace(/\D/g, ""));
    target.searchParams.set("callbackUrl", destination);
    // Auth.js sends a wrong code back to /login?error= and nothing else: no
    // address, no destination. This short-lived cookie is how the page knows
    // both, so a guest who mistypes a digit is not dropped out of their gallery.
    const remembered = encodeURIComponent(JSON.stringify({ email: email.trim().toLowerCase(), next: destination }));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SIGN_IN_CODE_COOKIE}=${remembered}; Max-Age=900; Path=/; SameSite=Lax${secure}`;
    window.location.href = target.toString();
  }

  const errorLine = error && (
    <p className="text-sm text-red-400" role="alert">
      {error}
    </p>
  );

  return (
    <div className="w-full max-w-sm space-y-6">
      {mode === "password" && (
        <form onSubmit={handlePassword} className="space-y-4">
          {/* Both, because two kinds of account sign in here. A venue set up at
              /admin/new was handed a generated username; somebody who signed
              themselves up only ever saw their email. Labelling it "Username"
              made the second group think they were on the wrong form. */}
          <Field label="Email or username">
            <input
              className={inputClass}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <PasswordInput
              id="login-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          {errorLine}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}

      {mode === "email" && (
        <form onSubmit={(event) => void sendCode(event)} className="space-y-4">
          <Field label="Email" hint="We send you a six-digit code. No password needed.">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              required
            />
          </Field>
          {errorLine}
          <Button type="submit" className="w-full" disabled={loading || !email.includes("@")}>
            {loading ? "Sending…" : "Email me a code"}
          </Button>
        </form>
      )}

      {mode === "code" && (
        <form onSubmit={submitCode} className="space-y-4">
          <p className="text-sm text-muted">
            We sent a code to <span className="text-paper">{email}</span>. It works for 10 minutes.
          </p>
          <Field label="Code" htmlFor="login-code">
            <input
              id="login-code"
              className={`${inputClass} text-center font-mono text-xl tracking-[0.4em]`}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              autoFocus
              required
            />
          </Field>
          {errorLine}
          <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
            {loading ? "Checking…" : "Sign in"}
          </Button>
          <div className="flex justify-between text-xs text-muted">
            <button type="button" className="hover:text-paper" onClick={() => setMode("email")}>
              Use a different email
            </button>
            <button type="button" className="hover:text-paper" disabled={loading} onClick={() => void sendCode()}>
              Send a new code
            </button>
          </div>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs text-muted">
        <div className="h-px flex-1 bg-canvas-line" />
        or
        <div className="h-px flex-1 bg-canvas-line" />
      </div>
      <div className="space-y-2">
        {mode !== "password" && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setError(null);
              setMode("password");
            }}
          >
            Sign in with a password
          </Button>
        )}
        {resendEnabled && mode === "password" && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setError(null);
              setMode("email");
            }}
          >
            Email me a code instead
          </Button>
        )}
        {googleEnabled && (
          <Button type="button" variant="ghost" className="w-full" onClick={() => signIn("google", { callbackUrl: destination })}>
            Continue with Google
          </Button>
        )}
      </div>
    </div>
  );
}
