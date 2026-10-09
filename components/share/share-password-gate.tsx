"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { denialCopy } from "@/lib/share-access";

/**
 * The password in front of a protected share link.
 *
 * Says nothing about what is behind it, not the event name and not whether it is
 * a photo or a video. Whoever sent the link said that; the page repeating it
 * would hand the same detail to anyone who got the address by accident.
 */
export function SharePasswordGate({ token, collection = false }: { token: string; collection?: boolean }) {
  const router = useRouter();
  const copy = denialCopy("password", collection);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/s/${token}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "That did not work. Try again.");
        setLoading(false);
        return;
      }

      // The cookie is set by the response, so re-rendering the server component
      // is what reveals the photo. Nothing about the photo was ever sent to this
      // page, so there is nothing here to reveal client-side.
      router.refresh();
    } catch {
      setError("Could not connect. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-canvas-line text-muted">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <h1 className="mt-5 text-center font-display text-2xl text-paper">
          {copy.title}
        </h1>
        <p className="mt-3 text-center text-sm text-muted">{copy.detail}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Field label="Password" htmlFor="share-password">
            <PasswordInput
              id="share-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
          </Field>
          {error && (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={loading || password.length === 0} className="w-full">
            {loading ? "Checking" : collection ? "Open the photos" : "Open the photo"}
          </Button>
        </form>
      </div>
    </main>
  );
}
