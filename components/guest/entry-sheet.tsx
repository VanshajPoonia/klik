"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

export function EntrySheet({
  slug,
  eventName,
  requiresPassword,
}: {
  slug: string;
  eventName: string;
  requiresPassword: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/e/${slug}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || undefined,
          consent: true,
          password: requiresPassword ? password : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        setLoading(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Could not connect. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center font-display text-2xl text-paper">{eventName}</h1>
        <p className="mt-2 text-center text-sm text-muted">
          {requiresPassword
            ? "Enter the gallery password to continue."
            : "Join the shared gallery."}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {requiresPassword && (
            <Field label="Gallery password" htmlFor="guest-gallery-password">
              <PasswordInput
                id="guest-gallery-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={72}
                required
                autoFocus
              />
            </Field>
          )}
          <Field label="Your first name (optional)">
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Maya"
              maxLength={80}
              autoComplete="given-name"
            />
          </Field>
          <Checkbox
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            required
          >
            I understand that photos and videos I upload may be visible to everyone with access
            to this event gallery, and I have the right to share them.
          </Checkbox>
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={loading || !consent} className="w-full">
            {loading ? "Joining…" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
