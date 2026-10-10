"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { CURRENT_CONSENT, consentText } from "@/lib/consent";
import { LanguageSwitch, useGuestCopy } from "@/components/guest/guest-copy";
import { refusalText } from "@/lib/i18n/guest";

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
  const { t, locale } = useGuestCopy();
  const consent_ = consentText(CURRENT_CONSENT, locale);
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
          // TRS-3: recorded with the consent, so it says which words were agreed to.
          locale,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(refusalText(t, data, t.common.somethingWrong));
        setLoading(false);
        return;
      }

      router.refresh();
    } catch {
      setError(t.common.noConnection);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-center font-display text-2xl text-paper">{eventName}</h1>
        <p className="mt-2 text-center text-sm text-muted">
          {requiresPassword ? t.entry.enterPassword : t.entry.join}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {requiresPassword && (
            <Field label={t.entry.password} htmlFor="guest-gallery-password">
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
          <Field label={t.entry.firstName}>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.entry.namePlaceholder}
              maxLength={80}
              autoComplete="given-name"
            />
          </Field>
          <Checkbox
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            required
          >
            {consent_.statement}
          </Checkbox>
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted">
            {consent_.detail}{" "}
            {/* The one place a guest is asked to agree to anything, so the one
                place the policy has to be reachable. Opens in a new tab: this
                form holds a half-typed name and an unticked box, and navigating
                away to read the policy would lose both. */}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-paper underline underline-offset-2 transition-colors hover:text-volt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
            >
              {t.common.privacyPolicy}
            </a>
          </p>
          <Button type="submit" disabled={loading || !consent} className="w-full">
            {loading ? t.entry.joining : t.entry.continue}
          </Button>
        </form>
        {/* TRS-3: before agreeing to anything, in a language the guest reads. */}
        <LanguageSwitch className="mt-6" />
      </div>
    </div>
  );
}
