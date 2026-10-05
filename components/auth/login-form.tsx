"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({
  googleEnabled,
  resendEnabled,
  next = null,
}: {
  googleEnabled: boolean;
  resendEnabled: boolean;
  /** Already sanitised on the server. Never read from the URL here. */
  next?: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
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

      if (next) {
        router.push(next);
      } else {
        const session = await fetch("/api/auth/session").then((res) => res.json());
        router.push(session?.user?.role === "superadmin" ? "/admin" : "/dashboard");
      }
      router.refresh();
    } catch {
      setError("Could not sign in. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Username">
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
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {(googleEnabled || resendEnabled) && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-canvas-line" />
            or
            <div className="h-px flex-1 bg-canvas-line" />
          </div>
          <div className="space-y-2">
            {googleEnabled && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => signIn("google", next ? { callbackUrl: next } : undefined)}
              >
                Continue with Google
              </Button>
            )}
            {resendEnabled && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => signIn("resend", next ? { callbackUrl: next } : undefined)}
              >
                Continue with email
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
