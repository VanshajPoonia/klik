"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputClass, selectClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { VisibilityField, type Visibility } from "@/components/dashboard/visibility-field";
import { endOfDayIso, toDateInputValue } from "@/lib/dates";
import type { OrganizerEvent } from "@/lib/events";
import type { Media, VenueClient } from "@/lib/schema";
import { galleryPalette } from "@/lib/color";
import { canUseProofs } from "@/lib/plans";

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
  profile = null,
  approvedMedia = [],
  clients = [],
  addressing = null,
}: {
  event: OrganizerEvent;
  /** QR-1: present when the plan allows a custom address. */
  addressing?: { origin: string; formerSlugs: string[] } | null;
  canManageClients?: boolean;
  canCustomizeGallery?: boolean;
  canCustomizeQr?: boolean;
  canUseVenueHub?: boolean;
  canDeleteEvent?: boolean;
  /** GRW-4: set only for the owner, whose profile this event may be listed on. */
  profile?: { isPublic: boolean; username: string } | null;
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
  const [reactionsEnabled, setReactionsEnabled] = useState(event.reactionsEnabled);
  const [commentsEnabled, setCommentsEnabled] = useState(event.commentsEnabled);
  const [momentsEnabled, setMomentsEnabled] = useState(event.momentsEnabled);
  const [recapEnabled, setRecapEnabled] = useState(event.recapEnabled);
  const [showOnProfile, setShowOnProfile] = useState(event.showOnProfile);
  const [guestLanguage, setGuestLanguage] = useState(event.guestLanguage);
  const [keepPhotoDetails, setKeepPhotoDetails] = useState(event.keepPhotoDetails);
  // MED-8: for the plans with a photographer on the team.
  const canKeepPhotoDetails = canUseProofs(event.planKey ?? "event");
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
  // CAM-4. The develop time is edited in the browser's own time zone, which is
  // the host's, and sent as an instant.
  const [slug, setSlug] = useState(event.slug);
  const [disposableMode, setDisposableMode] = useState(event.disposableMode);
  const [shotsPerGuest, setShotsPerGuest] = useState(event.shotsPerGuest);
  const [developsAt, setDevelopsAt] = useState(() => toDateTimeLocalValue(event.developsAt));
  const [developing, setDeveloping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const needsNewGalleryPassword =
    visibility === "password" && event.visibility !== "password";
  const approvedPhotos = approvedMedia.filter((item) => item.kind === "photo");

  /** Develops the roll now: the same setting, set to this moment. */
  async function developNow() {
    setDeveloping(true);
    setError(null);
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ developsAt: new Date().toISOString() }),
    });
    setDeveloping(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not develop the roll");
      return;
    }
    setDevelopsAt(toDateTimeLocalValue(new Date()));
    router.refresh();
  }

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
          reactionsEnabled,
          commentsEnabled,
          momentsEnabled,
          recapEnabled,
          guestLanguage,
          keepPhotoDetails: canKeepPhotoDetails ? keepPhotoDetails : undefined,
          // GRW-4: the owner's choice alone; a manager's save leaves it as it is.
          showOnProfile: profile ? showOnProfile && visibility !== "private" : undefined,
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
          slug: addressing && slug.trim() !== event.slug ? slug.trim() : undefined,
          disposableMode,
          shotsPerGuest,
          developsAt: developsAt ? new Date(developsAt).toISOString() : null,
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

  // SEC-4: typing the event's name, rather than clicking OK on a dialog. An
  // admin acting on the wrong row is the exact accident this guards against,
  // and a dialog is dismissed by muscle memory where a name is not.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  const nameMatches = typedName.trim() === event.name.trim();

  async function handleDelete() {
    if (!nameMatches) return;
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
          {/* TRS-3: the gallery's own palette, so what is seen here is what guests get. */}
          <GalleryColorPreview accent={accentColor} background={backgroundColor} />
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

      {addressing && (
        <Field
          label="Gallery address"
          htmlFor="gallery-address"
          hint="Changing it keeps every old address working, so signs you already printed still scan."
        >
          <div className="flex items-center overflow-hidden rounded-xl border border-canvas-line bg-canvas focus-within:border-volt/60">
            <span className="shrink-0 pl-3.5 text-sm text-muted">{addressing.origin.replace(/^https?:\/\//, "")}/e/</span>
            <input
              id="gallery-address"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-paper focus:outline-none"
              value={slug}
              onChange={(change) => setSlug(change.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              maxLength={60}
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          {addressing.formerSlugs.length > 0 && (
            <p className="mt-1.5 text-xs text-muted">
              Still working: {addressing.formerSlugs.map((former) => `/e/${former}`).join(", ")}
            </p>
          )}
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
          hint="Saving, sending and story images. When it is off, guests can still save and send their own uploads, and copy a link that opens a photo in the gallery."
        >
          Guests can download photos and videos
        </Checkbox>
        <Checkbox
          checked={reactionsEnabled}
          onChange={(event) => setReactionsEnabled(event.target.checked)}
          hint="A heart under each photo, and a double tap. No account needed, and you see the counts here."
        >
          Guests can heart photos
        </Checkbox>
        <Checkbox
          checked={commentsEnabled}
          onChange={(event) => setCommentsEnabled(event.target.checked)}
          hint="Guests sign in with their email to comment, so nobody is anonymous. You can hide any comment, and three reports hide one until you look."
        >
          Guests can comment
        </Checkbox>
        <Checkbox
          checked={momentsEnabled}
          onChange={(event) => setMomentsEnabled(event.target.checked)}
          hint="Klik splits the gallery wherever there was a long pause in the photos, like before and after the ceremony. Rename them from the gallery tab."
        >
          Show guests the gallery in moments
        </Checkbox>
        <Checkbox
          checked={recapEnabled}
          onChange={(change) => setRecapEnabled(change.target.checked)}
          hint="Guests can leave an email when they join, with its own tick. The morning after, each gets one email of the highlights and a link back here, and Klik deletes the address. Nobody is sent anything they did not ask for."
        >
          Offer guests the best photos by email the morning after
        </Checkbox>
        {canKeepPhotoDetails && (
          <Checkbox
            checked={keepPhotoDetails}
            onChange={(change) => setKeepPhotoDetails(change.target.checked)}
            hint="For a photographer on your team: their JPEGs keep the camera, lens, settings and copyright, and are not shrunk on the way up. Where a photo was taken is always removed. Guests' photos are unchanged."
          >
            Keep camera details on the team&apos;s photos
          </Checkbox>
        )}
        {/* TRS-3: guests can still pick their own at the bottom of the gallery. */}
        <Field label="Language guests see" hint="Guests can still switch at the bottom of the gallery.">
          <select
            className={selectClass}
            value={guestLanguage}
            onChange={(change) => setGuestLanguage(change.target.value as typeof guestLanguage)}
          >
            <option value="auto">Each guest&apos;s own phone language</option>
            <option value="en">English</option>
            <option value="es">Español (Spanish)</option>
          </select>
        </Field>
        {profile && (
          <Checkbox
            checked={showOnProfile && visibility !== "private"}
            disabled={visibility === "private"}
            onChange={(event) => setShowOnProfile(event.target.checked)}
            hint={
              visibility === "private"
                ? "A private gallery cannot be listed."
                : profile.isPublic
                  ? `Its name and date appear on your profile at /u/${profile.username}, linking to this gallery. Guests' photos are never shown there.`
                  : "Its name and date will appear on your public profile once you turn the profile on in your account."
            }
          >
            List on my public profile
          </Checkbox>
        )}
      </div>

      <fieldset className="space-y-3 rounded-xl border border-canvas-line p-4">
        <Checkbox
          checked={disposableMode}
          onChange={(change) => setDisposableMode(change.target.checked)}
          hint="Each guest gets a roll of shots and nobody sees anything until it develops. People compose instead of spraying, and the reveal becomes a moment."
        >
          Disposable camera
        </Checkbox>
        {disposableMode && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Shots per guest" htmlFor="shots-per-guest">
              <input
                id="shots-per-guest"
                type="number"
                min={1}
                max={200}
                className={inputClass}
                value={shotsPerGuest}
                onChange={(change) => setShotsPerGuest(Math.max(1, Math.min(200, Number(change.target.value) || 1)))}
              />
            </Field>
            <Field
              label="Roll develops"
              htmlFor="develops-at"
              hint="Leave empty to develop it yourself. The morning after is a good default."
            >
              <input
                id="develops-at"
                type="datetime-local"
                className={inputClass}
                value={developsAt}
                onChange={(change) => setDevelopsAt(change.target.value)}
                suppressHydrationWarning
              />
            </Field>
            <div className="sm:col-span-2">
              <Button variant="ghost" size="sm" onClick={() => void developNow()} disabled={developing || saving}>
                {developing ? "Developing…" : "Develop now"}
              </Button>
            </div>
          </div>
        )}
      </fieldset>

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
        <div className="space-y-3 border-t border-canvas-line pt-5">
          {confirmingDelete ? (
            <>
              <p className="text-sm text-muted">
                This takes the gallery down for everyone. Every photo and video stays recoverable
                for 30 days from your dashboard, then is permanently removed. Type{" "}
                <span className="font-medium text-paper">{event.name}</span> to confirm.
              </p>
              <input
                aria-label="Type the event name to confirm"
                className={inputClass}
                value={typedName}
                onChange={(change) => setTypedName(change.target.value)}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={saving || deleting || !nameMatches}
                >
                  {deleting ? "Deleting…" : "Delete event"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setTypedName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={saving || deleting}>
              Delete event
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** A Date as the value a datetime-local input wants, in the browser's zone. */
function toDateTimeLocalValue(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** TRS-3: a small gallery in the chosen colours, held to WCAG as the real one is. */
function GalleryColorPreview({ accent, background }: { accent: string; background: string }) {
  const palette = galleryPalette(accent, background);
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-canvas-line p-4" style={{ backgroundColor: background }} aria-hidden="true">
        <p className="font-display text-lg" style={{ color: palette.paper }}>
          Ana and Bo&apos;s wedding
        </p>
        <p className="mt-0.5 text-xs" style={{ color: palette.muted }}>
          128 items shared
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full px-4 py-2 text-sm font-medium" style={{ backgroundColor: palette.volt, color: palette.onVolt }}>
            Camera
          </span>
          <span className="text-sm font-medium underline" style={{ color: palette.volt }}>
            Add media
          </span>
        </div>
      </div>
      <p className="text-xs text-muted">
        {palette.accentAdjusted
          ? "Your accent is a little darker or lighter on this background, where it is a button or a link, so everyone can read it. The camera and photo viewer keep it as chosen."
          : "Text and buttons are checked to stay readable for everyone."}
      </p>
    </div>
  );
}

