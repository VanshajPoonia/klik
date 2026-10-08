"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { apiRequest } from "@/lib/api-client";
import { PASSWORD_MIN } from "@/lib/signup";

/**
 * Changing the password ends every session, this one included, because that is
 * the only revocation a JWT has. So it signs straight back in with the new one.
 */
export function PasswordForm({ signInAs }: { signInAs: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await apiRequest(
      `/api/me/password`,
      { method: "POST", body: { current, next } },
      "Could not change your password",
    );
    if (!result.ok) {
      setBusy(false);
      setMessage({ tone: "error", text: result.error });
      return;
    }
    const again = await signIn("credentials", { username: signInAs, password: next, redirect: false });
    setBusy(false);
    setCurrent("");
    setNext("");
    if (!again || again.error) {
      router.replace("/login?next=/dashboard/account");
      return;
    }
    setMessage({ tone: "ok", text: "Changed. Every other device has been signed out." });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h2 className="text-sm font-medium text-paper">Password</h2>
      <Field label="Current password" htmlFor="account-current-password">
        <PasswordInput
          id="account-current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" htmlFor="account-new-password" hint={`At least ${PASSWORD_MIN} characters.`}>
        <PasswordInput
          id="account-new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !current || next.length < PASSWORD_MIN}>
          Change password
        </Button>
        {message && (
          <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-red-400"}`} role={message.tone === "ok" ? "status" : "alert"}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
