"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import type { OrganizerEvent } from "@/lib/events";

type Visibility = "public" | "password" | "private";

export function EventSettingsForm({
  event,
  canManageClients = false,
}: {
  event: OrganizerEvent;
  canManageClients?: boolean;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<Visibility>(event.visibility as Visibility);
  const [password, setPassword] = useState("");
  const [moderation, setModeration] = useState(event.moderation);
  const [downloadsEnabled, setDownloadsEnabled] = useState(event.downloadsEnabled);
  const [uploadsEnabled, setUploadsEnabled] = useState(event.uploadsEnabled);
  const [expiresAt, setExpiresAt] = useState(
    event.expiresAt ? new Date(event.expiresAt).toISOString().slice(0, 10) : "",
  );
  const [clientName, setClientName] = useState(event.clientName ?? "");
  const [clientEmail, setClientEmail] = useState(event.clientEmail ?? "");
  const [clientPhone, setClientPhone] = useState(event.clientPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const needsNewGalleryPassword =
    visibility === "password" && event.visibility !== "password";

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visibility,
        password: visibility === "password" && password ? password : undefined,
        moderation,
        downloadsEnabled,
        uploadsEnabled,
        expiresAt: expiresAt || null,
        clientName: canManageClients ? clientName || null : undefined,
        clientEmail: canManageClients ? clientEmail || null : undefined,
        clientPhone: canManageClients ? clientPhone || null : undefined,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save settings");
      return;
    }
    setPassword("");
    setSaved(true);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${event.name}" and all its photos? This can't be undone.`)) return;
    await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    router.push("/dashboard");
  }

  return (
    <Card className="max-w-xl space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Field label="Expires on (optional)">
          <input
            type="date"
            className={inputClass}
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>
      </div>

      {visibility === "password" && (
        <Field
          label="New gallery password"
          hint={
            needsNewGalleryPassword
              ? "Guests will enter this password to open the gallery"
              : "Leave blank to keep the current password"
          }
          htmlFor="event-settings-gallery-password"
        >
          <PasswordInput
            id="event-settings-gallery-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={4}
            maxLength={72}
            required={needsNewGalleryPassword}
          />
        </Field>
      )}

      {canManageClients && (
        <fieldset className="space-y-4 rounded-xl border border-canvas-line p-4">
          <legend className="px-1 text-sm font-medium text-paper">Client details</legend>
          <Field label="Client name" hint="Visible only to the organizer and administrators">
            <input
              className={inputClass}
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              maxLength={120}
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
              />
            </Field>
            <Field label="Client phone">
              <input
                type="tel"
                className={inputClass}
                value={clientPhone}
                onChange={(event) => setClientPhone(event.target.value)}
                maxLength={40}
              />
            </Field>
          </div>
        </fieldset>
      )}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-paper">
          <input
            type="checkbox"
            checked={moderation}
            onChange={(event) => setModeration(event.target.checked)}
            className="h-4 w-4 rounded border-canvas-line accent-volt"
          />
          Review photos before they go public
        </label>
        <label className="flex items-center gap-2 text-sm text-paper">
          <input
            type="checkbox"
            checked={uploadsEnabled}
            onChange={(event) => setUploadsEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-canvas-line accent-volt"
          />
          Uploads open
        </label>
        <label className="flex items-center gap-2 text-sm text-paper">
          <input
            type="checkbox"
            checked={downloadsEnabled}
            onChange={(event) => setDownloadsEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-canvas-line accent-volt"
          />
          Guests can download photos and videos
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {saved && <span className="text-xs text-muted">Saved</span>}
      </div>

      <div className="border-t border-canvas-line pt-5">
        <Button variant="danger" onClick={handleDelete}>
          Delete event
        </Button>
      </div>
    </Card>
  );
}
