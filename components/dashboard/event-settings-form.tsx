"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { VisibilityField, type Visibility } from "@/components/dashboard/visibility-field";
import { endOfDayIso, toDateInputValue } from "@/lib/dates";
import type { OrganizerEvent } from "@/lib/events";
import type { Media, VenueClient } from "@/lib/schema";

const COVER_CHOICES = 30;

function CoverPicker({
  photos,
  value,
  onChange,
}: {
  photos: Array<Media & { thumbSrc?: string | null }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = photos.find((photo) => photo.id === value);
  const choices = photos.slice(0, COVER_CHOICES);
  if (selected && !choices.some((photo) => photo.id === selected.id)) {
    choices.unshift(selected);
  }

  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        Cover photo
      </legend>
      {choices.length === 0 ? (
        <p className="text-sm text-muted">
          Approved photos show up here as guests add them, and you can pick one as the cover.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          <button
            type="button"
            onClick={() => onChange("")}
            aria-pressed={value === ""}
            className={`flex aspect-square items-center justify-center rounded-lg border-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
              value === ""
                ? "border-volt text-paper"
                : "border-canvas-line text-muted hover:text-paper"
            }`}
          >
            None
          </button>
          {choices.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => onChange(photo.id)}
              aria-pressed={value === photo.id}
              aria-label={`Use photo ${index + 1} as the cover`}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                value === photo.id ? "border-volt" : "border-transparent hover:border-paper/40"
              }`}
            >
              <Image
                src={photo.thumbSrc ?? `${photo.blobUrl}?thumb=1`}
                alt=""
                fill
                unoptimized
                sizes="96px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function EventSettingsForm({
  event,
  canManageClients = false,
  canCustomizeGallery = false,
  canCustomizeQr = false,
  canUseVenueHub = false,
  canDeleteEvent = false,
  approvedMedia = [],
  clients = [],
}: {
  event: OrganizerEvent;
  canManageClients?: boolean;
  canCustomizeGallery?: boolean;
  canCustomizeQr?: boolean;
  canUseVenueHub?: boolean;
  canDeleteEvent?: boolean;
  approvedMedia?: Media[];
  clients?: VenueClient[];
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<Visibility>(event.visibility as Visibility);
  const [password, setPassword] = useState("");
  const [moderation, setModeration] = useState(event.moderation);
  const [isActive, setIsActive] = useState(event.isActive);
  const [downloadsEnabled, setDownloadsEnabled] = useState(event.downloadsEnabled);
  const [uploadsEnabled, setUploadsEnabled] = useState(event.uploadsEnabled);
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(event.expiresAt));
  const [clientName, setClientName] = useState(event.clientName ?? "");
  const [clientEmail, setClientEmail] = useState(event.clientEmail ?? "");
  const [clientPhone, setClientPhone] = useState(event.clientPhone ?? "");
  const [clientId, setClientId] = useState(event.clientId ?? "");
  const [coverMediaId, setCoverMediaId] = useState(event.coverMediaId ?? "");
  const [accentColor, setAccentColor] = useState(event.accentColor);
  const [backgroundColor, setBackgroundColor] = useState(event.backgroundColor);
  const [qrTemplate, setQrTemplate] = useState(event.qrTemplate);
  const [venueFeatured, setVenueFeatured] = useState(event.venueFeatured);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const needsNewGalleryPassword =
    visibility === "password" && event.visibility !== "password";
  const approvedPhotos = approvedMedia.filter((item) => item.kind === "photo");

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility,
          password: visibility === "password" && password ? password : undefined,
          moderation,
          isActive,
          downloadsEnabled,
          uploadsEnabled,
          expiresAt: endOfDayIso(expiresAt),
          clientId: canManageClients ? clientId || null : undefined,
          clientName: canManageClients ? clientName || null : undefined,
          clientEmail: canManageClients ? clientEmail || null : undefined,
          clientPhone: canManageClients ? clientPhone || null : undefined,
          coverMediaId: canCustomizeGallery ? coverMediaId || null : undefined,
          accentColor: canCustomizeGallery ? accentColor : undefined,
          backgroundColor: canCustomizeGallery ? backgroundColor : undefined,
          qrTemplate: canCustomizeQr ? qrTemplate : undefined,
          venueFeatured: canUseVenueHub ? venueFeatured : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save settings");
        return;
      }
      setPassword("");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not save settings. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${event.name}" and all its photos? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not delete this event");
        setDeleting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not delete this event. Check your connection and try again.");
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <VisibilityField value={visibility} onChange={setVisibility} />
        <Field label="Expires on (optional)" hint="The gallery closes at the end of this day">
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
          {clients.length > 0 && (
            <Field label="Saved client">
              <select
                className={inputClass}
                value={clientId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setClientId(nextId);
                  const selected = clients.find((client) => client.id === nextId);
                  if (selected) {
                    setClientName(selected.name);
                    setClientEmail(selected.email ?? "");
                    setClientPhone(selected.phone ?? "");
                  }
                }}
              >
                <option value="">No saved client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Client name" hint="Visible only to the organizer and administrators">
            <input
              className={inputClass}
              value={clientName}
              onChange={(event) => {
                setClientName(event.target.value);
                setClientId("");
              }}
              maxLength={120}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client email">
              <input
                type="email"
                className={inputClass}
                value={clientEmail}
                onChange={(event) => {
                  setClientEmail(event.target.value);
                  setClientId("");
                }}
                maxLength={254}
              />
            </Field>
            <Field label="Client phone">
              <input
                type="tel"
                className={inputClass}
                value={clientPhone}
                onChange={(event) => {
                  setClientPhone(event.target.value);
                  setClientId("");
                }}
                maxLength={40}
              />
            </Field>
          </div>
        </fieldset>
      )}

      {canCustomizeGallery && (
        <fieldset className="space-y-4 rounded-xl border border-canvas-line p-4">
          <legend className="px-1 text-sm font-medium text-paper">Gallery appearance</legend>
          <CoverPicker photos={approvedPhotos} value={coverMediaId} onChange={setCoverMediaId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Accent color">
              <input
                type="color"
                className={`${inputClass} h-11 p-1`}
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
              />
            </Field>
            <Field label="Background color">
              <input
                type="color"
                className={`${inputClass} h-11 p-1`}
                value={backgroundColor}
                onChange={(event) => setBackgroundColor(event.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted">Text and buttons adjust automatically to stay readable.</p>
        </fieldset>
      )}

      {canCustomizeQr && (
        <Field label="QR sign template">
          <select
            className={inputClass}
            value={qrTemplate}
            onChange={(event) =>
              setQrTemplate(event.target.value as OrganizerEvent["qrTemplate"])
            }
          >
            <option value="classic">Classic</option>
            <option value="minimal">Minimal</option>
            <option value="bold">Bold</option>
          </select>
        </Field>
      )}

      <div>
        <Checkbox
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          hint="Turn this off when the event is over. It frees up a plan slot and stops uploads."
        >
          Event is active
        </Checkbox>
        {canUseVenueHub && (
          <Checkbox
            checked={venueFeatured}
            onChange={(event) => setVenueFeatured(event.target.checked)}
          >
            Send the reusable venue QR to this event
          </Checkbox>
        )}
        <Checkbox
          checked={moderation}
          onChange={(event) => setModeration(event.target.checked)}
        >
          Review photos before they go public
        </Checkbox>
        <Checkbox
          checked={uploadsEnabled}
          onChange={(event) => setUploadsEnabled(event.target.checked)}
          hint="Pause or resume guest uploads without ending the event."
        >
          Uploads open
        </Checkbox>
        <Checkbox
          checked={downloadsEnabled}
          onChange={(event) => setDownloadsEnabled(event.target.checked)}
        >
          Guests can download photos and videos
        </Checkbox>
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || deleting}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {saved && (
          <span className="text-xs text-muted" role="status">
            Saved
          </span>
        )}
      </div>

      {canDeleteEvent && (
        <div className="border-t border-canvas-line pt-5">
          <Button variant="danger" onClick={handleDelete} disabled={saving || deleting}>
            {deleting ? "Deleting…" : "Delete event"}
          </Button>
        </div>
      )}
    </Card>
  );
}
