"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

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
      setLoading(false);
      setError(data.error ?? "Something went wrong");
      return;
    }

    router.refresh();
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
            <Field label="Gallery password">
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoFocus
              />
            </Field>
          )}
          <Field label="Your name (optional)" hint="Shown next to your uploads">
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Maya"
            />
          </Field>
          <label className="flex items-start gap-2.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-canvas-line accent-volt"
              required
            />
            I understand that photos and videos I upload may be visible to everyone with access
            to this event gallery, and I have the right to share them.
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading || !consent} className="w-full">
            {loading ? "Joining…" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
