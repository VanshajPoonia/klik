"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

type Visibility = "public" | "password" | "private";

export function CreateEventForm({
  canCreate = true,
  canManageClients = false,
  limitMessage,
}: {
  canCreate?: boolean;
  canManageClients?: boolean;
  limitMessage?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [password, setPassword] = useState("");
  const [moderation, setModeration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        eventDate: eventDate || null,
        clientName: canManageClients ? clientName : undefined,
        clientEmail: canManageClients ? clientEmail : undefined,
        clientPhone: canManageClients ? clientPhone : undefined,
        visibility,
        password: visibility === "password" ? password : undefined,
        moderation,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLoading(false);
      setError(data.error ?? "Could not create event");
      return;
    }

    const { event: created } = await res.json();
    router.push(`/dashboard/events/${created.id}`);
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button onClick={() => setOpen(true)} disabled={!canCreate}>
          New event
        </Button>
        {!canCreate && limitMessage && (
          <p className="max-w-xl text-xs leading-relaxed text-muted">{limitMessage}</p>
        )}
      </div>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Event name">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Anita & Raj's wedding"
            required
          />
        </Field>
        {canManageClients && (
          <fieldset className="space-y-4 rounded-xl border border-canvas-line p-4">
            <legend className="px-1 text-sm font-medium text-paper">Client details</legend>
            <Field label="Client name" hint="Optional internal contact for this event">
              <input
                className={inputClass}
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                maxLength={120}
                placeholder="Anita and Raj"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Client email">
                <input
                  type="email"
                  className={inputClass}
                  value={clientEmail}
                  onChange={(event) => setClientEmail(event.target.value)}
                  maxLength={254}
                  placeholder="client@example.com"
                />
              </Field>
              <Field label="Client phone">
                <input
                  type="tel"
                  className={inputClass}
                  value={clientPhone}
                  onChange={(event) => setClientPhone(event.target.value)}
                  maxLength={40}
                  placeholder="+1 555 0100"
                />
              </Field>
            </div>
          </fieldset>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Event date (optional)">
            <input
              type="date"
              className={inputClass}
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </Field>
          <Field label="Gallery access">
            <select
              className={inputClass}
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as Visibility)}
            >
              <option value="public">Public - anyone with the link</option>
              <option value="password">Password protected</option>
              <option value="private">Private - organizer only</option>
            </select>
          </Field>
        </div>
        {visibility === "password" && (
          <Field label="Gallery password" htmlFor="create-event-gallery-password">
            <PasswordInput
              id="create-event-gallery-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={4}
              maxLength={72}
              required
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-paper">
          <input
            type="checkbox"
            checked={moderation}
            onChange={(event) => setModeration(event.target.checked)}
            className="h-4 w-4 rounded border-canvas-line accent-volt"
          />
          Review photos before they go public
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create event"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
