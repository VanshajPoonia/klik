"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await apiRequest(`/api/me`, { method: "PATCH", body: { name } }, "Could not save your name");
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setSaved(name.trim());
    setMessage({ tone: "ok", text: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h2 className="text-sm font-medium text-paper">Name</h2>
      <Field label="Your name" hint="Shown to people on your events' teams, and on invitations you send.">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={120}
          required
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !name.trim() || name.trim() === saved}>
          Save
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
