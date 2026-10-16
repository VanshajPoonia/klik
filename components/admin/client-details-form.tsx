"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

/**
 * Correct an account's name, email or handle. Saves only what changed, and the
 * account's history records what each field was before.
 */
export function ClientDetailsForm({
  userId,
  initial,
}: {
  userId: string;
  initial: { name: string | null; email: string | null; username: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [username, setUsername] = useState(initial.username ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const dirty =
    name.trim() !== (initial.name ?? "") ||
    email.trim().toLowerCase() !== (initial.email ?? "") ||
    username.trim().replace(/^@/, "").toLowerCase() !== (initial.username ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const body: Record<string, string> = {};
    if (name.trim() !== (initial.name ?? "")) body.name = name.trim();
    if (email.trim().toLowerCase() !== (initial.email ?? "")) body.email = email.trim();
    const handle = username.trim().replace(/^@/, "");
    if (handle.toLowerCase() !== (initial.username ?? "")) body.username = handle;
    const response = await fetch(`/api/admin/clients/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: result.error ?? "Could not save" });
      return;
    }
    setMessage({ tone: "ok", text: "Saved, and written to their history." });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="client-name">
          <input
            id="client-name"
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Email" htmlFor="client-email" hint="What their Stripe payment carries. Empty for none.">
          <input
            id="client-email"
            type="email"
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
          />
        </Field>
        <Field label="Handle" htmlFor="client-username" hint="The old one is held for 30 days.">
          <input
            id="client-username"
            className={inputClass}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save details"}
        </Button>
        {message && (
          <p
            className={`text-xs ${message.tone === "error" ? "text-red-400" : "text-muted"}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
